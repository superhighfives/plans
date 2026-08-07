import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '~/db'
import type { Installation, PlanCacheRow, Repo } from '~/db/schema'
import { auditLog, installations, planCache, repos } from '~/db/schema'
import type { AppEnv } from '~/env'
import { findOpenQuestions } from '~/lib/ai/plan-prompts'
import { newId } from '~/lib/crypto'
import { getInstallationToken } from '~/lib/github/app'
import { GitHubError } from '~/lib/github/client'
import {
  fetchBlobText,
  fetchContentFile,
  listOpenPullRequests,
  listPlanTree,
  type OpenPullRequest,
} from '~/lib/github/plans'
import { createCommit, putFile } from '~/lib/github/write'
import { diffPlanTrees, type PlanEntry } from '~/lib/plans/diff'
import {
  type Frontmatter,
  isValidPlanFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
} from '~/lib/plans/frontmatter'
import { slugify, uniqueSlug } from '~/lib/plans/slug'
import {
  PLAN_STATES,
  type PlanPathInfo,
  type PlanState,
  parsePlanPath,
  planStateDef,
} from '~/lib/plans/states'
import { unifiedDiff } from '~/lib/plans/text-diff'
import type {
  BranchActivityStatus,
  NewBacklogPreview,
  PlanBranchTab,
  PlanDetail,
  PlanMovePreview,
  PlanSummary,
  PlanView,
  PullRequestActivity,
  RepoPlans,
  RepoRef,
} from '~/lib/plans/types'
import { getUserInstallationIds } from './users.server'

export interface RepoContext {
  repo: Repo
  installation: Installation
}

function toRepoRef(repo: Repo): RepoRef {
  return {
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    isPrivate: repo.isPrivate,
  }
}

/**
 * Resolve owner/name to a repo the user is allowed to see. The multi-tenant
 * boundary: a repo is only reachable if it belongs to an installation the user
 * is linked to. Returns null when not found or not permitted (callers 404 both
 * the same way, so we don't leak existence).
 */
export async function resolveAccessibleRepo(
  db: Db,
  userId: string,
  owner: string,
  name: string,
): Promise<RepoContext | null> {
  const installationIds = await getUserInstallationIds(db, userId)
  if (installationIds.length === 0) return null

  const repo = await db.query.repos.findFirst({
    where: and(
      eq(repos.owner, owner),
      eq(repos.name, name),
      inArray(repos.installationId, installationIds),
    ),
  })
  if (!repo) return null

  const installation = await db.query.installations.findFirst({
    where: eq(installations.id, repo.installationId),
  })
  if (!installation) return null

  return { repo, installation }
}

/**
 * Resolve a repo + its installation by owner/name WITHOUT a user scope. For use
 * inside the Flue Durable Object, which is only reachable after the socket gate
 * (`authorizeAgent`) has already verified the connecting user's access — so the
 * DO needs the installation (to mint a token) but not a second user check.
 */
export async function findRepoContext(
  db: Db,
  owner: string,
  name: string,
): Promise<RepoContext | null> {
  const repo = await db.query.repos.findFirst({
    where: and(eq(repos.owner, owner), eq(repos.name, name)),
  })
  if (!repo) return null
  const installation = await db.query.installations.findFirst({
    where: eq(installations.id, repo.installationId),
  })
  if (!installation) return null
  return { repo, installation }
}

function rowToSummary(row: PlanCacheRow): PlanSummary | null {
  const info = parsePlanPath(row.path)
  if (!info) return null
  return {
    path: row.path,
    state: info.state,
    slug: info.slug,
    title: row.title,
    status: row.status,
    created: row.createdFm,
    updated: row.updatedFm,
    bodySha: row.bodySha,
  }
}

function emptyStates(): Record<PlanState, PlanSummary[]> {
  return { backlog: [], ready: [], 'in-progress': [], done: [] }
}

/** Parse a frontmatter date to a sortable epoch; unparseable/absent sorts last. */
function completedMs(p: PlanSummary): number {
  const raw = p.updated ?? p.created
  if (!raw) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/** Most-recently-completed first; ties (and undated plans) fall back to title. */
function compareByCompletedDesc(a: PlanSummary, b: PlanSummary): number {
  const diff = completedMs(b) - completedMs(a)
  return diff !== 0 ? diff : a.title.localeCompare(b.title)
}

/**
 * Load a repo's plans, refreshing the D1 cache incrementally against the git
 * tree. Blobs whose sha is unchanged since the last load are reused from cache;
 * only new/changed files are fetched. Invalid frontmatter is skipped ("detect
 * and skip").
 */
export async function loadRepoPlans(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
): Promise<RepoPlans> {
  const { repo, installation } = ctx
  const token = await getInstallationToken(db, env, installation)
  const tree = await listPlanTree(
    token,
    repo.owner,
    repo.name,
    repo.defaultBranch,
  )

  const existing = await db
    .select()
    .from(planCache)
    .where(eq(planCache.repoId, repo.id))
  const byPath = new Map(existing.map((r) => [r.path, r]))

  const nowMs = Date.now()
  const summaries: PlanSummary[] = []
  const seenPaths = new Set<string>()

  for (const entry of tree.entries) {
    seenPaths.add(entry.path)
    const cached = byPath.get(entry.path)

    if (cached && cached.bodySha === entry.sha) {
      const summary = rowToSummary(cached)
      if (summary) summaries.push(summary)
      continue
    }

    const text = await fetchBlobText(token, repo.owner, repo.name, entry.sha)
    const parsed = parseFrontmatter(text)
    if (!isValidPlanFrontmatter(parsed.data)) continue

    const info = parsePlanPath(entry.path)!
    const title = parsed.data.title ?? info.slug
    await db
      .insert(planCache)
      .values({
        id: cached?.id ?? newId(),
        repoId: repo.id,
        path: entry.path,
        state: info.state,
        title,
        status: parsed.data.status ?? null,
        createdFm: parsed.data.created ?? null,
        updatedFm: parsed.data.updated ?? null,
        bodySha: entry.sha,
        body: parsed.content,
        cachedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [planCache.repoId, planCache.path],
        set: {
          state: info.state,
          title,
          status: parsed.data.status ?? null,
          createdFm: parsed.data.created ?? null,
          updatedFm: parsed.data.updated ?? null,
          bodySha: entry.sha,
          body: parsed.content,
          cachedAt: nowMs,
        },
      })

    summaries.push({
      path: entry.path,
      state: info.state,
      slug: info.slug,
      title,
      status: parsed.data.status ?? null,
      created: parsed.data.created ?? null,
      updated: parsed.data.updated ?? null,
      bodySha: entry.sha,
    })
  }

  // Evict cache rows for plans that no longer exist.
  const stalePaths = existing
    .filter((r) => !seenPaths.has(r.path))
    .map((r) => r.id)
  if (stalePaths.length > 0) {
    await db.delete(planCache).where(inArray(planCache.id, stalePaths))
  }

  // Record the tree sha we cached against. `hasPlans` uses the same metric as
  // discovery (`scanRepo`): whether any file matches the plans/<state>/*.md
  // path — NOT whether any has valid frontmatter. The two paths must agree, or
  // opening a repo whose plan files lack frontmatter would silently downgrade
  // `hasPlans` and evict it from the dashboard. A repo with matching paths but
  // no valid plans stays listed and renders its "No plans found" empty state.
  await db
    .update(repos)
    .set({
      lastScannedSha: tree.treeSha,
      lastScannedAt: nowMs,
      hasPlans: tree.entries.length > 0,
      updatedAt: nowMs,
    })
    .where(eq(repos.id, repo.id))

  const states = emptyStates()
  for (const summary of summaries) states[summary.state].push(summary)
  for (const state of PLAN_STATES) {
    // Done reads as a history: most-recently-completed first (the `updated`
    // frontmatter date is our best proxy for when it shipped). Everything else
    // is browsed by name.
    states[state].sort(
      state === 'done'
        ? (a, b) => compareByCompletedDesc(a, b)
        : (a, b) => a.title.localeCompare(b.title),
    )
  }

  const { activity, status } = await loadBranchActivity(
    token,
    repo.owner,
    repo.name,
  )

  return {
    repo: toRepoRef(repo),
    states,
    truncated: tree.truncated,
    branchActivity: activity,
    branchActivityStatus: status,
  }
}

/**
 * Diff each open PR's plan tree against the commit it actually forked from (not
 * the default branch's current tip) to find plans that are added / moved
 * between states / modified / removed on a branch. Diffing against the live
 * tip would misreport stale branches (e.g. an old dependabot PR opened before
 * other plans moved states): everything the default branch did since the PR
 * forked would show up as a change the PR itself never made. Best-effort: a
 * missing `pull_requests: read` scope (403) degrades to a "no-access" status
 * so the board can prompt for it; any other error just yields empty activity so
 * the board never fails to render. Per-PR tree fetches run in parallel and a
 * single failing PR (e.g. a fork we can't read) is skipped, not fatal.
 */
async function loadBranchActivity(
  token: string,
  owner: string,
  repo: string,
): Promise<{ activity: PullRequestActivity[]; status: BranchActivityStatus }> {
  let pulls: Awaited<ReturnType<typeof listOpenPullRequests>>
  try {
    pulls = await listOpenPullRequests(token, owner, repo)
  } catch (err) {
    if (
      err instanceof GitHubError &&
      (err.status === 403 || err.status === 404)
    )
      return { activity: [], status: 'no-access' }
    return { activity: [], status: 'ok' }
  }

  // Multiple open PRs (e.g. a batch of dependabot bumps) often share the same
  // fork point — fetch each distinct base sha's plan tree once.
  const baseTreeCache = new Map<string, Promise<PlanEntry[]>>()
  function baseEntriesAt(sha: string): Promise<PlanEntry[]> {
    let entries = baseTreeCache.get(sha)
    if (!entries) {
      entries = listPlanTree(token, owner, repo, sha).then((t) => t.entries)
      baseTreeCache.set(sha, entries)
    }
    return entries
  }

  const activity = await Promise.all(
    pulls.map(async (pr): Promise<PullRequestActivity | null> => {
      try {
        const [baseEntries, headTree] = await Promise.all([
          baseEntriesAt(pr.baseSha),
          listPlanTree(token, owner, repo, pr.headSha),
        ])
        const changes = diffPlanTrees(baseEntries, headTree.entries)
        if (changes.length === 0) return null
        return {
          number: pr.number,
          title: pr.title,
          authorLogin: pr.authorLogin,
          url: pr.url,
          draft: pr.draft,
          headRef: pr.headRef,
          updatedAt: pr.updatedAt,
          changes,
        }
      } catch {
        return null
      }
    }),
  )

  return {
    activity: activity
      .filter((a): a is PullRequestActivity => a !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    status: 'ok',
  }
}

/**
 * Load a single plan's full detail. Prefers the cache when the body is present;
 * otherwise (e.g. direct navigation) fetches the file fresh and caches it.
 */
export async function loadPlanDetail(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
  path: string,
): Promise<PlanDetail | null> {
  const info = parsePlanPath(path)
  if (!info) return null

  const { repo, installation } = ctx
  const cached = await db.query.planCache.findFirst({
    where: and(eq(planCache.repoId, repo.id), eq(planCache.path, path)),
  })
  if (cached && cached.body != null) {
    return {
      path,
      state: info.state,
      slug: info.slug,
      title: cached.title,
      status: cached.status,
      created: cached.createdFm,
      updated: cached.updatedFm,
      bodySha: cached.bodySha,
      body: cached.body,
    }
  }

  const token = await getInstallationToken(db, env, installation)
  const file = await fetchContentFile(
    token,
    repo.owner,
    repo.name,
    path,
    repo.defaultBranch,
  )
  if (!file) return null

  const parsed = parseFrontmatter(file.text)
  if (!isValidPlanFrontmatter(parsed.data)) return null
  const title = parsed.data.title ?? info.slug

  await db
    .insert(planCache)
    .values({
      id: cached?.id ?? newId(),
      repoId: repo.id,
      path,
      state: info.state,
      title,
      status: parsed.data.status ?? null,
      createdFm: parsed.data.created ?? null,
      updatedFm: parsed.data.updated ?? null,
      bodySha: file.sha,
      body: parsed.content,
      cachedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [planCache.repoId, planCache.path],
      set: {
        title,
        status: parsed.data.status ?? null,
        createdFm: parsed.data.created ?? null,
        updatedFm: parsed.data.updated ?? null,
        bodySha: file.sha,
        body: parsed.content,
        cachedAt: Date.now(),
      },
    })

  return {
    path,
    state: info.state,
    slug: info.slug,
    title,
    status: parsed.data.status ?? null,
    created: parsed.data.created ?? null,
    updated: parsed.data.updated ?? null,
    bodySha: file.sha,
    body: parsed.content,
  }
}

/** The raw file text of a plan on the default branch, plus its blob sha. */
export interface PlanSource {
  path: string
  /** Verbatim file content (frontmatter + body), as stored in git. */
  content: string
  /** Git blob sha — carried back on save as the base-SHA conflict guard. */
  sha: string
}

/**
 * Fetch a plan's raw file for editing: the exact bytes on the default branch and
 * the blob sha to write against. Read fresh (not from the stripped body cache)
 * so hand-editing round-trips every frontmatter key, including ones the reader
 * doesn't model (e.g. `scope`).
 */
export async function loadPlanSource(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
  path: string,
): Promise<PlanSource | null> {
  if (!parsePlanPath(path)) return null
  const { repo, installation } = ctx
  const token = await getInstallationToken(db, env, installation)
  const file = await fetchContentFile(
    token,
    repo.owner,
    repo.name,
    path,
    repo.defaultBranch,
  )
  if (!file) return null
  return { path, content: file.text, sha: file.sha }
}

export type WritePlanResult =
  | { ok: true; plan: PlanDetail }
  /** The base sha was stale — someone else changed the file first. */
  | { ok: false; reason: 'conflict' }
  /** The edited content is no longer a valid plan (missing title). */
  | { ok: false; reason: 'invalid' }

/**
 * Write a hand-edited plan back to GitHub as one App-authored commit to the
 * default branch, guarded by the base sha the edit started from. On success the
 * D1 cache is refreshed to the new content/sha and the mutation is recorded in
 * the audit log against the user who triggered it.
 */
export async function writePlan(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
  userId: string,
  path: string,
  content: string,
  baseSha: string,
): Promise<WritePlanResult> {
  const info = parsePlanPath(path)
  if (!info) return { ok: false, reason: 'invalid' }

  const parsed = parseFrontmatter(content)
  if (!isValidPlanFrontmatter(parsed.data))
    return { ok: false, reason: 'invalid' }
  const title = parsed.data.title ?? info.slug

  const { repo, installation } = ctx
  const token = await getInstallationToken(db, env, installation)

  let result: Awaited<ReturnType<typeof putFile>>
  try {
    result = await putFile(token, repo.owner, repo.name, path, {
      content,
      message: `plans: update ${title}`,
      sha: baseSha,
      branch: repo.defaultBranch,
    })
  } catch (err) {
    // 409 (sha mismatch) and 422 (also raised for stale sha) both mean the base
    // moved under us — surface as a conflict rather than a hard error.
    if (
      err instanceof GitHubError &&
      (err.status === 409 || err.status === 422)
    )
      return { ok: false, reason: 'conflict' }
    throw err
  }

  const nowMs = Date.now()
  await db
    .insert(planCache)
    .values({
      id: newId(),
      repoId: repo.id,
      path,
      state: info.state,
      title,
      status: parsed.data.status ?? null,
      createdFm: parsed.data.created ?? null,
      updatedFm: parsed.data.updated ?? null,
      bodySha: result.blobSha,
      body: parsed.content,
      cachedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [planCache.repoId, planCache.path],
      set: {
        state: info.state,
        title,
        status: parsed.data.status ?? null,
        createdFm: parsed.data.created ?? null,
        updatedFm: parsed.data.updated ?? null,
        bodySha: result.blobSha,
        body: parsed.content,
        cachedAt: nowMs,
      },
    })

  await db.insert(auditLog).values({
    id: newId(),
    userId,
    repoId: repo.id,
    action: 'plan.update',
    paths: JSON.stringify([path]),
    commitSha: result.commitSha,
    createdAt: nowMs,
  })

  return {
    ok: true,
    plan: {
      path,
      state: info.state,
      slug: info.slug,
      title,
      status: parsed.data.status ?? null,
      created: parsed.data.created ?? null,
      updated: parsed.data.updated ?? null,
      bodySha: result.blobSha,
      body: parsed.content,
    },
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Package a rewritten body into a full move preview — re-attach frontmatter
 * with the deterministic lifecycle fields, derive the destination path, diff
 * against the source, and check whether a different plan already occupies
 * the destination. Used by Flue's conversational move (slice 4), which owns
 * getting to `newBody` via its `ask_user` loop.
 */
export async function buildMovePreview(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
  input: {
    path: string
    toState: PlanState
    title: string
    source: PlanSource
    frontmatter: Frontmatter
    newBody: string
  },
): Promise<PlanMovePreview> {
  const info = parsePlanPath(input.path)
  if (!info) throw new Error('Not a plan path')

  const newContent = serializeFrontmatter(
    {
      ...input.frontmatter,
      status: planStateDef(input.toState).status,
      updated: todayIso(),
    },
    input.newBody,
  )
  const newPath = `plans/${input.toState}/${info.slug}.md`

  // Slugs aren't unique across state directories, so the destination path can
  // already hold a *different* plan. Surface that here so the preview can warn —
  // committing would otherwise overwrite it. commitPlanMove re-checks and blocks.
  const { repo, installation } = ctx
  const token = await getInstallationToken(db, env, installation)
  const destination = await fetchContentFile(
    token,
    repo.owner,
    repo.name,
    newPath,
    repo.defaultBranch,
  )

  return {
    title: input.title,
    fromState: info.state,
    toState: input.toState,
    oldPath: input.path,
    newPath,
    oldContent: input.source.content,
    newContent,
    baseSha: input.source.sha,
    diff: unifiedDiff(input.source.content, newContent),
    warnings: input.toState === 'ready' ? findOpenQuestions(input.newBody) : [],
    destinationExists: destination !== null,
  }
}

export type MovePlanResult =
  | { ok: true; newPath: string; commitSha: string }
  /** The source file changed on GitHub since the preview was drafted. */
  | { ok: false; reason: 'conflict' }
  /** A different plan already occupies the destination path — refused to clobber it. */
  | { ok: false; reason: 'destination-exists' }

/**
 * Commit an approved move as one atomic commit (delete old path + write new
 * path) via the Git Data API, guarded by the base sha the preview was drafted
 * from. Both cache rows are dropped so the next load rebuilds from GitHub.
 */
export async function commitPlanMove(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
  userId: string,
  input: {
    oldPath: string
    newPath: string
    newContent: string
    baseSha: string
  },
): Promise<MovePlanResult> {
  const newInfo = parsePlanPath(input.newPath)
  if (!parsePlanPath(input.oldPath) || !newInfo)
    throw new Error('Invalid plan path')

  const { repo, installation } = ctx
  const token = await getInstallationToken(db, env, installation)

  // Conflict guard: the source file must be unchanged since the preview.
  const current = await fetchContentFile(
    token,
    repo.owner,
    repo.name,
    input.oldPath,
    repo.defaultBranch,
  )
  if (!current || current.sha !== input.baseSha)
    return { ok: false, reason: 'conflict' }

  // Never overwrite a different plan already sitting at the destination path.
  const occupant = await fetchContentFile(
    token,
    repo.owner,
    repo.name,
    input.newPath,
    repo.defaultBranch,
  )
  if (occupant) return { ok: false, reason: 'destination-exists' }

  const parsed = parseFrontmatter(input.newContent)
  if (!isValidPlanFrontmatter(parsed.data))
    throw new Error('Proposed plan is missing a title')
  const title = parsed.data.title ?? newInfo.slug

  const { commitSha } = await createCommit(
    token,
    repo.owner,
    repo.name,
    repo.defaultBranch,
    {
      message: `plans: move ${title} to ${planStateDef(newInfo.state).label}`,
      changes: [
        { path: input.oldPath, content: null },
        { path: input.newPath, content: input.newContent },
      ],
    },
  )

  await db
    .delete(planCache)
    .where(
      and(
        eq(planCache.repoId, repo.id),
        inArray(planCache.path, [input.oldPath, input.newPath]),
      ),
    )

  await db.insert(auditLog).values({
    id: newId(),
    userId,
    repoId: repo.id,
    action: 'plan.move',
    paths: JSON.stringify([input.oldPath, input.newPath]),
    commitSha,
    createdAt: Date.now(),
  })

  return { ok: true, newPath: input.newPath, commitSha }
}

/**
 * Derive a collision-free filename and serialized frontmatter for a drafted
 * {title, body} and package it as a preview — the part of backlog-drafting
 * that isn't the AI call itself. Used by Flue's conversational draft
 * (`FlueAgent`, slice 3), which owns getting to `{title, body}` via its
 * `ask_user` loop.
 */
export async function buildBacklogPreview(
  token: string,
  repo: Repo,
  draft: { title: string; body: string },
): Promise<NewBacklogPreview> {
  const title = draft.title.trim() || 'Untitled plan'
  const body = draft.body.trim()

  // Derive a filename that doesn't collide with an existing backlog plan. Slugs
  // are only unique within a state directory, so we only compare against backlog.
  const tree = await listPlanTree(
    token,
    repo.owner,
    repo.name,
    repo.defaultBranch,
  )
  const takenSlugs = new Set(
    tree.entries
      .map((e) => parsePlanPath(e.path))
      .filter((i): i is PlanPathInfo => i?.state === 'backlog')
      .map((i) => i.slug),
  )
  const slug = uniqueSlug(slugify(title), takenSlugs)
  const path = `plans/backlog/${slug}.md`

  const newContent = serializeFrontmatter(
    {
      title,
      status: planStateDef('backlog').status,
      created: todayIso(),
      updated: todayIso(),
    },
    body,
  )

  return { title, slug, path, newContent, body }
}

export type CreatePlanResult =
  | { ok: true; path: string; commitSha: string }
  /** A file already exists at the destination path — refused to clobber it. */
  | { ok: false; reason: 'exists' }

/**
 * Commit an approved new backlog item as one App-authored commit via the
 * Contents API create path (no base sha → GitHub 422s if the path already
 * exists, our guard against clobbering a file added since the preview). On
 * success the cache row is seeded and the mutation is recorded in the audit log.
 */
export async function commitNewBacklog(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
  userId: string,
  input: { path: string; newContent: string },
): Promise<CreatePlanResult> {
  const info = parsePlanPath(input.path)
  if (!info || info.state !== 'backlog')
    throw new Error('New plans go into plans/backlog/')

  const parsed = parseFrontmatter(input.newContent)
  if (!isValidPlanFrontmatter(parsed.data))
    throw new Error('Proposed plan is missing a title')
  const title = parsed.data.title ?? info.slug

  const { repo, installation } = ctx
  const token = await getInstallationToken(db, env, installation)

  let result: Awaited<ReturnType<typeof putFile>>
  try {
    result = await putFile(token, repo.owner, repo.name, input.path, {
      content: input.newContent,
      message: `plans: add ${title}`,
      branch: repo.defaultBranch,
    })
  } catch (err) {
    // 422 = a file already exists at this path on a create-only PUT (someone
    // added it between the preview and now) — surface so the user re-drafts.
    if (err instanceof GitHubError && err.status === 422)
      return { ok: false, reason: 'exists' }
    throw err
  }

  const nowMs = Date.now()
  await db
    .insert(planCache)
    .values({
      id: newId(),
      repoId: repo.id,
      path: input.path,
      state: info.state,
      title,
      status: parsed.data.status ?? null,
      createdFm: parsed.data.created ?? null,
      updatedFm: parsed.data.updated ?? null,
      bodySha: result.blobSha,
      body: parsed.content,
      cachedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [planCache.repoId, planCache.path],
      set: {
        state: info.state,
        title,
        status: parsed.data.status ?? null,
        createdFm: parsed.data.created ?? null,
        updatedFm: parsed.data.updated ?? null,
        bodySha: result.blobSha,
        body: parsed.content,
        cachedAt: nowMs,
      },
    })

  await db.insert(auditLog).values({
    id: newId(),
    userId,
    repoId: repo.id,
    action: 'plan.create',
    paths: JSON.stringify([input.path]),
    commitSha: result.commitSha,
    createdAt: nowMs,
  })

  return { ok: true, path: input.path, commitSha: result.commitSha }
}

function defaultTab(): PlanBranchTab {
  return {
    kind: 'default',
    number: null,
    title: null,
    url: null,
    draft: false,
    changeKind: null,
  }
}

/** A PR whose head branch changes this specific plan (in a way we can render). */
interface PlanBranchCandidate {
  pr: OpenPullRequest
  headPath: string
  changeKind: 'moved' | 'modified'
}

/**
 * Resolve a plan for the detail view: its content at the chosen ref (the default
 * branch, or an open PR's head), plus one tab per open PR that changes this plan.
 *
 * Only PRs where the plan still exists on the head become tabs — a PR that
 * deletes the plan has no body to show. The plan must exist on the default
 * branch (that's how the detail page is reached); a plan that lives only on a
 * branch is surfaced via the board's ghost card instead.
 *
 * PR-head content is fetched fresh and never written to planCache (that cache
 * holds default-branch content, keyed by path). Best-effort throughout: a missing
 * pull_requests scope or a per-PR fetch failure just narrows the tabs.
 */
export async function loadPlanView(
  db: Db,
  env: AppEnv,
  ctx: RepoContext,
  path: string,
  prNumber: number | null,
): Promise<PlanView | null> {
  const base = await loadPlanDetail(db, env, ctx, path)
  if (!base) return null

  const info = parsePlanPath(path)
  if (!info) return null

  const { repo, installation } = ctx
  const token = await getInstallationToken(db, env, installation)

  let pulls: OpenPullRequest[]
  try {
    pulls = await listOpenPullRequests(token, repo.owner, repo.name)
  } catch (err) {
    const noAccess =
      err instanceof GitHubError && (err.status === 403 || err.status === 404)
    return {
      plan: base,
      activePr: null,
      tabs: [defaultTab()],
      diff: null,
      branchActivityStatus: noAccess ? 'no-access' : 'ok',
    }
  }

  const candidates = (
    await Promise.all(
      pulls.map(async (pr): Promise<PlanBranchCandidate | null> => {
        try {
          const [baseTree, headTree] = await Promise.all([
            listPlanTree(token, repo.owner, repo.name, pr.baseSha),
            listPlanTree(token, repo.owner, repo.name, pr.headSha),
          ])
          const entry = headTree.entries.find(
            (e) => parsePlanPath(e.path)?.slug === info.slug,
          )
          if (!entry) return null // added-only or removed on this branch
          const headInfo = parsePlanPath(entry.path)
          if (!headInfo) return null
          // Compare against the plan's state at the PR's fork point, not the
          // default branch's current tip — a stale branch (e.g. an old
          // dependabot PR) otherwise reads as "moved" purely because the plan
          // moved on the default branch *after* the PR forked.
          const forkEntry = baseTree.entries.find(
            (e) => parsePlanPath(e.path)?.slug === info.slug,
          )
          const forkInfo = forkEntry ? parsePlanPath(forkEntry.path) : null
          const priorState = forkInfo?.state ?? base.state
          const priorSha = forkEntry?.sha ?? base.bodySha
          if (headInfo.state !== priorState)
            return { pr, headPath: entry.path, changeKind: 'moved' }
          if (entry.sha !== priorSha)
            return { pr, headPath: entry.path, changeKind: 'modified' }
          return null // identical on this branch
        } catch {
          return null
        }
      }),
    )
  )
    .filter((c): c is PlanBranchCandidate => c !== null)
    .sort((a, b) => b.pr.updatedAt.localeCompare(a.pr.updatedAt))

  const tabs: PlanBranchTab[] = [
    defaultTab(),
    ...candidates.map(
      (c): PlanBranchTab => ({
        kind: 'pr',
        number: c.pr.number,
        title: c.pr.title,
        url: c.pr.url,
        draft: c.pr.draft,
        changeKind: c.changeKind,
      }),
    ),
  ]

  const active =
    prNumber != null
      ? candidates.find((c) => c.pr.number === prNumber)
      : undefined

  // No PR requested, or a stale ?pr that no longer changes this plan → default.
  if (!active) {
    return {
      plan: base,
      activePr: null,
      tabs,
      diff: null,
      branchActivityStatus: 'ok',
    }
  }

  const file = await fetchContentFile(
    token,
    repo.owner,
    repo.name,
    active.headPath,
    active.pr.headSha,
  )
  if (!file) {
    return {
      plan: base,
      activePr: null,
      tabs,
      diff: null,
      branchActivityStatus: 'ok',
    }
  }
  const parsed = parseFrontmatter(file.text)
  const headInfo = parsePlanPath(active.headPath)
  const plan: PlanDetail = {
    path: active.headPath,
    state: headInfo?.state ?? base.state,
    slug: info.slug,
    title: parsed.data.title ?? base.title,
    status: parsed.data.status ?? null,
    created: parsed.data.created ?? null,
    updated: parsed.data.updated ?? null,
    bodySha: file.sha,
    body: parsed.content,
  }
  // Diff the body default → branch so the detail view can show what changed.
  const diff = unifiedDiff(base.body, plan.body)
  return {
    plan,
    activePr: active.pr.number,
    tabs,
    diff,
    branchActivityStatus: 'ok',
  }
}
