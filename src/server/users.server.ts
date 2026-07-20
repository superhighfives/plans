import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '~/db'
import { installations, userInstallations, users } from '~/db/schema'
import type { User } from '~/db/schema'
import { newId } from '~/lib/crypto'
import type { GitHubUser, UserInstallation } from '~/lib/github/oauth'

/**
 * Upsert the user and the set of installations they can access, then rebuild
 * the user→installation mapping. Called during the OAuth callback. This is a
 * point-in-time snapshot: if the user installs the App somewhere new later,
 * they refresh it by signing in again.
 */
export async function upsertUserAndInstallations(
  db: Db,
  ghUser: GitHubUser,
  ghInstallations: UserInstallation[],
): Promise<User> {
  const nowMs = Date.now()

  const [user] = await db
    .insert(users)
    .values({
      id: newId(),
      githubUserId: ghUser.id,
      login: ghUser.login,
      name: ghUser.name,
      avatarUrl: ghUser.avatar_url,
    })
    .onConflictDoUpdate({
      target: users.githubUserId,
      set: {
        login: ghUser.login,
        name: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        updatedAt: nowMs,
      },
    })
    .returning()

  if (!user) throw new Error('Failed to upsert user')

  // Upsert each installation and collect their app ids.
  const installationIds: string[] = []
  for (const inst of ghInstallations) {
    if (!inst.account) continue
    const [row] = await db
      .insert(installations)
      .values({
        id: newId(),
        githubInstallationId: inst.id,
        accountLogin: inst.account.login,
        accountType: inst.account.type,
        accountAvatarUrl: inst.account.avatar_url,
        suspendedAt: inst.suspended_at ? Date.parse(inst.suspended_at) : null,
      })
      .onConflictDoUpdate({
        target: installations.githubInstallationId,
        set: {
          accountLogin: inst.account.login,
          accountType: inst.account.type,
          accountAvatarUrl: inst.account.avatar_url,
          suspendedAt: inst.suspended_at ? Date.parse(inst.suspended_at) : null,
          updatedAt: nowMs,
        },
      })
      .returning({ id: installations.id })
    if (row) installationIds.push(row.id)
  }

  // Rebuild the mapping for this user (drop stale links, add current ones).
  await db.delete(userInstallations).where(eq(userInstallations.userId, user.id))
  if (installationIds.length > 0) {
    await db
      .insert(userInstallations)
      .values(
        installationIds.map((installationId) => ({ userId: user.id, installationId })),
      )
      .onConflictDoNothing()
  }

  return user
}

/** Load an app user by id. */
export async function getUserById(db: Db, id: string): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) })
  return row ?? null
}

/** The installation ids a user may access. */
export async function getUserInstallationIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ installationId: userInstallations.installationId })
    .from(userInstallations)
    .where(eq(userInstallations.userId, userId))
  return rows.map((r) => r.installationId)
}

/** Assert (and return) that a user is linked to a given installation. */
export async function assertUserInstallation(
  db: Db,
  userId: string,
  installationId: string,
): Promise<boolean> {
  const row = await db
    .select({ userId: userInstallations.userId })
    .from(userInstallations)
    .where(
      and(
        eq(userInstallations.userId, userId),
        eq(userInstallations.installationId, installationId),
      ),
    )
    .limit(1)
  return row.length > 0
}

/** Filter a set of installation ids to those the user can access. */
export async function filterAccessibleInstallations(
  db: Db,
  userId: string,
  installationIds: string[],
): Promise<Set<string>> {
  if (installationIds.length === 0) return new Set()
  const rows = await db
    .select({ installationId: userInstallations.installationId })
    .from(userInstallations)
    .where(
      and(
        eq(userInstallations.userId, userId),
        inArray(userInstallations.installationId, installationIds),
      ),
    )
  return new Set(rows.map((r) => r.installationId))
}
