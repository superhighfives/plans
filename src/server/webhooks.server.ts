import { and, eq } from 'drizzle-orm'
import type { Db } from '~/db'
import { installations, planCache, repos } from '~/db/schema'
import type { AppEnv } from '~/env'
import { getInstallationToken } from '~/lib/github/app'
import { listPlanTree } from '~/lib/github/plans'

/**
 * On a push to a repo's default branch, refresh that repo's plan detection and
 * evict its cached bodies so the next view refetches. Best-effort: if the repo
 * or installation isn't known yet, we no-op (a future dashboard scan finds it).
 */
export async function handlePush(db: Db, env: AppEnv, payload: any): Promise<void> {
  const repoId: number | undefined = payload?.repository?.id
  const defaultBranch: string | undefined = payload?.repository?.default_branch
  const ref: string | undefined = payload?.ref
  const installationId: number | undefined = payload?.installation?.id
  if (!repoId || !defaultBranch || !ref || !installationId) return
  if (ref !== `refs/heads/${defaultBranch}`) return

  const repo = await db.query.repos.findFirst({ where: eq(repos.githubRepoId, repoId) })
  if (!repo) return
  const installation = await db.query.installations.findFirst({
    where: eq(installations.githubInstallationId, installationId),
  })
  if (!installation) return

  try {
    const token = await getInstallationToken(db, env, installation)
    const tree = await listPlanTree(token, repo.owner, repo.name, repo.defaultBranch)
    await db
      .update(repos)
      .set({
        hasPlans: tree.entries.length > 0,
        lastScannedSha: tree.treeSha,
        lastScannedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(repos.id, repo.id))
  } catch {
    // Ignore transient errors; the next on-demand load re-validates anyway.
  }

  // Evict cached bodies so the next open refetches the latest content.
  await db.delete(planCache).where(eq(planCache.repoId, repo.id))
}

/** Add/remove/suspend installations in response to `installation` events. */
export async function handleInstallation(db: Db, payload: any): Promise<void> {
  const action: string | undefined = payload?.action
  const inst = payload?.installation
  const githubInstallationId: number | undefined = inst?.id
  if (!action || !githubInstallationId) return

  if (action === 'deleted') {
    await db
      .delete(installations)
      .where(eq(installations.githubInstallationId, githubInstallationId))
    return
  }

  if (action === 'suspend' || action === 'unsuspend') {
    await db
      .update(installations)
      .set({
        suspendedAt: action === 'suspend' ? Date.now() : null,
        updatedAt: Date.now(),
      })
      .where(eq(installations.githubInstallationId, githubInstallationId))
    return
  }

  // created / new_permissions_accepted — upsert the installation shell. The
  // user→installation link is (re)built when that user next signs in.
  const account = inst?.account
  if (!account) return
  await db
    .insert(installations)
    .values({
      id: crypto.randomUUID(),
      githubInstallationId,
      accountLogin: account.login,
      accountType: account.type,
      accountAvatarUrl: account.avatar_url,
    })
    .onConflictDoUpdate({
      target: installations.githubInstallationId,
      set: {
        accountLogin: account.login,
        accountType: account.type,
        accountAvatarUrl: account.avatar_url,
        updatedAt: Date.now(),
      },
    })
}
