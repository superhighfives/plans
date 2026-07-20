import { and, eq, inArray } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { getDb, type Db } from '~/db'
import { installations as installationsTable, repos } from '~/db/schema'
import { getEnv } from '~/env'
import { authMiddleware } from './auth-middleware'
import { scanUserInstallations } from './scan.server'
import { getUserInstallationIds } from './users.server'

export interface DashboardRepo {
  owner: string
  name: string
  fullName: string
  isPrivate: boolean
  defaultBranch: string
}

export interface DashboardInstallation {
  id: string
  accountLogin: string
  accountType: string
  accountAvatarUrl: string | null
  suspended: boolean
  repos: DashboardRepo[]
}

export interface Dashboard {
  installations: DashboardInstallation[]
  reposWithPlans: number
  lastScannedAt: number | null
}

async function buildDashboard(db: Db, userId: string): Promise<Dashboard> {
  const ids = await getUserInstallationIds(db, userId)
  if (ids.length === 0) {
    return { installations: [], reposWithPlans: 0, lastScannedAt: null }
  }

  const instRows = await db
    .select()
    .from(installationsTable)
    .where(inArray(installationsTable.id, ids))

  const repoRows = await db
    .select()
    .from(repos)
    .where(and(inArray(repos.installationId, ids), eq(repos.hasPlans, true)))

  const reposByInstallation = new Map<string, DashboardRepo[]>()
  let lastScannedAt: number | null = null
  for (const r of repoRows) {
    const list = reposByInstallation.get(r.installationId) ?? []
    list.push({
      owner: r.owner,
      name: r.name,
      fullName: r.fullName,
      isPrivate: r.isPrivate,
      defaultBranch: r.defaultBranch,
    })
    reposByInstallation.set(r.installationId, list)
    if (r.lastScannedAt && (!lastScannedAt || r.lastScannedAt > lastScannedAt)) {
      lastScannedAt = r.lastScannedAt
    }
  }

  const installations: DashboardInstallation[] = instRows
    .map((inst) => ({
      id: inst.id,
      accountLogin: inst.accountLogin,
      accountType: inst.accountType,
      accountAvatarUrl: inst.accountAvatarUrl,
      suspended: inst.suspendedAt != null,
      repos: (reposByInstallation.get(inst.id) ?? []).sort((a, b) =>
        a.fullName.localeCompare(b.fullName),
      ),
    }))
    .sort((a, b) => a.accountLogin.localeCompare(b.accountLogin))

  return {
    installations,
    reposWithPlans: repoRows.length,
    lastScannedAt,
  }
}

/**
 * Dashboard data for the current user. On the very first load (no repos cached
 * yet) it runs a discovery scan inline so the dashboard is useful immediately;
 * thereafter it reads the cache. Use `refreshDashboard` to force a re-scan.
 */
export const getDashboard = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Dashboard> => {
    const db = getDb()
    const env = getEnv()
    const ids = await getUserInstallationIds(db, context.user.id)

    if (ids.length > 0) {
      const [anyRepo] = await db
        .select({ id: repos.id })
        .from(repos)
        .where(inArray(repos.installationId, ids))
        .limit(1)
      if (!anyRepo) {
        // First load — populate the cache before rendering.
        await scanUserInstallations(db, env, context.user.id)
      }
    }

    return buildDashboard(db, context.user.id)
  })

/** Force a re-scan of all the user's installations, then return fresh data. */
export const refreshDashboard = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Dashboard> => {
    const db = getDb()
    await scanUserInstallations(db, getEnv(), context.user.id)
    return buildDashboard(db, context.user.id)
  })
