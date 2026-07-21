import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '~/db'
import type { Installation, PlanCacheRow, Repo } from '~/db/schema'
import { installations, planCache, repos } from '~/db/schema'
import type { AppEnv } from '~/env'
import { newId } from '~/lib/crypto'
import { getInstallationToken } from '~/lib/github/app'
import {
  fetchBlobText,
  fetchContentFile,
  listPlanTree,
} from '~/lib/github/plans'
import {
  isValidPlanFrontmatter,
  parseFrontmatter,
} from '~/lib/plans/frontmatter'
import { PLAN_STATES, type PlanState, parsePlanPath } from '~/lib/plans/states'
import type {
  PlanDetail,
  PlanSummary,
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

  // Record the tree sha we cached against.
  await db
    .update(repos)
    .set({
      lastScannedSha: tree.treeSha,
      lastScannedAt: nowMs,
      hasPlans: summaries.length > 0,
      updatedAt: nowMs,
    })
    .where(eq(repos.id, repo.id))

  const states = emptyStates()
  for (const summary of summaries) states[summary.state].push(summary)
  for (const state of PLAN_STATES) {
    states[state].sort((a, b) => a.title.localeCompare(b.title))
  }

  return { repo: toRepoRef(repo), states, truncated: tree.truncated }
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
