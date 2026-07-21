import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '~/db'
import type { Installation, PlanCacheRow, Repo } from '~/db/schema'
import { installations, planCache, repos } from '~/db/schema'
import type { AppEnv } from '~/env'
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
import { diffPlanTrees, type PlanEntry } from '~/lib/plans/diff'
import {
  isValidPlanFrontmatter,
  parseFrontmatter,
} from '~/lib/plans/frontmatter'
import { PLAN_STATES, type PlanState, parsePlanPath } from '~/lib/plans/states'
import { unifiedDiff } from '~/lib/plans/text-diff'
import type {
  BranchActivityStatus,
  PlanBranchTab,
  PlanDetail,
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
    tree.entries,
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
 * Diff each open PR's plan tree against the default branch to find plans that
 * are added / moved between states / modified / removed on a branch. Best-effort:
 * a missing `pull_requests: read` scope (403) degrades to a "no-access" status
 * so the board can prompt for it; any other error just yields empty activity so
 * the board never fails to render. Per-PR tree fetches run in parallel and a
 * single failing PR (e.g. a fork we can't read) is skipped, not fatal.
 */
async function loadBranchActivity(
  token: string,
  owner: string,
  repo: string,
  baseEntries: PlanEntry[],
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

  const activity = await Promise.all(
    pulls.map(async (pr): Promise<PullRequestActivity | null> => {
      try {
        const headTree = await listPlanTree(token, owner, repo, pr.headSha)
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
          const headTree = await listPlanTree(
            token,
            repo.owner,
            repo.name,
            pr.headSha,
          )
          const entry = headTree.entries.find(
            (e) => parsePlanPath(e.path)?.slug === info.slug,
          )
          if (!entry) return null // added-only or removed on this branch
          const headInfo = parsePlanPath(entry.path)
          if (!headInfo) return null
          if (headInfo.state !== base.state)
            return { pr, headPath: entry.path, changeKind: 'moved' }
          if (entry.sha !== base.bodySha)
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
