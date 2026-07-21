import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '~/db'
import type { Installation } from '~/db/schema'
import { installations as installationsTable, repos } from '~/db/schema'
import type { AppEnv } from '~/env'
import { newId } from '~/lib/crypto'
import {
  getInstallationToken,
  type InstallationRepo,
  listInstallationRepos,
} from '~/lib/github/app'
import { listPlanTree } from '~/lib/github/plans'
import { getUserInstallationIds } from './users.server'

/**
 * Run `tasks` with a bounded number in flight. Discovery touches one tree
 * endpoint per repo; a small concurrency keeps us well under rate limits while
 * staying fast for the "hundreds of repos" target.
 *
 * NOTE: In v1 this runs inline (on-demand / manual refresh). The plan calls for
 * moving fan-out onto Cloudflare Queues; the logic is factored so `scanRepo`
 * can be lifted into a queue consumer without change. See README "Deviations".
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await fn(items[index]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

async function scanRepo(
  token: string,
  ghRepo: InstallationRepo,
): Promise<{ hasPlans: boolean; treeSha: string | null }> {
  try {
    const tree = await listPlanTree(
      token,
      ghRepo.owner.login,
      ghRepo.name,
      ghRepo.default_branch,
    )
    return { hasPlans: tree.entries.length > 0, treeSha: tree.treeSha }
  } catch {
    // Empty repo, missing branch, permissions, etc. — treat as "no plans".
    return { hasPlans: false, treeSha: null }
  }
}

export interface InstallationScanResult {
  installationId: string
  repoCount: number
  withPlans: number
}

/** Scan a single installation: list its repos, detect plans/, upsert rows. */
export async function scanInstallation(
  db: Db,
  env: AppEnv,
  installation: Installation,
): Promise<InstallationScanResult> {
  const token = await getInstallationToken(db, env, installation)
  const ghRepos = await listInstallationRepos(token)
  const nowMs = Date.now()

  const scanned = await mapLimit(ghRepos, 8, async (ghRepo) => {
    const { hasPlans, treeSha } = await scanRepo(token, ghRepo)
    return { ghRepo, hasPlans, treeSha }
  })

  for (const { ghRepo, hasPlans, treeSha } of scanned) {
    await db
      .insert(repos)
      .values({
        id: newId(),
        installationId: installation.id,
        githubRepoId: ghRepo.id,
        fullName: ghRepo.full_name,
        owner: ghRepo.owner.login,
        name: ghRepo.name,
        defaultBranch: ghRepo.default_branch,
        isPrivate: ghRepo.private,
        hasPlans,
        lastScannedSha: treeSha,
        lastScannedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [repos.installationId, repos.githubRepoId],
        set: {
          fullName: ghRepo.full_name,
          owner: ghRepo.owner.login,
          name: ghRepo.name,
          defaultBranch: ghRepo.default_branch,
          isPrivate: ghRepo.private,
          hasPlans,
          lastScannedSha: treeSha,
          lastScannedAt: nowMs,
          updatedAt: nowMs,
        },
      })
  }

  // Drop repos the installation can no longer see. D1 caps bound parameters at
  // 100 per query, so we diff in memory and delete only the stale IDs (usually
  // none) rather than sending every seen ID in a NOT IN clause.
  const seen = new Set(ghRepos.map((r) => r.id))
  if (seen.size > 0) {
    const existing = await db
      .select({ githubRepoId: repos.githubRepoId })
      .from(repos)
      .where(eq(repos.installationId, installation.id))

    const stale = existing
      .map((r) => r.githubRepoId)
      .filter((id) => !seen.has(id))

    for (let i = 0; i < stale.length; i += 100) {
      const chunk = stale.slice(i, i + 100)
      await db
        .delete(repos)
        .where(
          and(
            eq(repos.installationId, installation.id),
            inArray(repos.githubRepoId, chunk),
          ),
        )
    }
  } else {
    await db.delete(repos).where(eq(repos.installationId, installation.id))
  }

  return {
    installationId: installation.id,
    repoCount: ghRepos.length,
    withPlans: scanned.filter((s) => s.hasPlans).length,
  }
}

/** Scan every installation the user can access. */
export async function scanUserInstallations(
  db: Db,
  env: AppEnv,
  userId: string,
): Promise<InstallationScanResult[]> {
  const ids = await getUserInstallationIds(db, userId)
  if (ids.length === 0) return []
  const rows = await db
    .select()
    .from(installationsTable)
    .where(inArray(installationsTable.id, ids))

  const results: InstallationScanResult[] = []
  for (const inst of rows) {
    if (inst.suspendedAt) continue
    results.push(await scanInstallation(db, env, inst))
  }
  return results
}
