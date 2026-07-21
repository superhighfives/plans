import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { isPlanPath } from '~/lib/plans/states'
import type { PlanDetail, RepoPlans } from '~/lib/plans/types'
import { authMiddleware } from './auth-middleware'
import {
  loadPlanDetail,
  loadRepoPlans,
  resolveAccessibleRepo,
} from './plans.server'

interface RepoInput {
  owner: string
  repo: string
}

interface PlanInput extends RepoInput {
  path: string
}

function validateRepoInput(data: RepoInput): RepoInput {
  if (!data?.owner || !data?.repo)
    throw new Error('owner and repo are required')
  return { owner: String(data.owner), repo: String(data.repo) }
}

/** Plans for a repo, grouped by state. Enforces per-user access to the repo. */
export const getRepoPlans = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(validateRepoInput)
  .handler(async ({ context, data }): Promise<RepoPlans> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    return loadRepoPlans(db, getEnv(), ctx)
  })

/** Force-refresh a repo's plans from GitHub. */
export const refreshRepoPlans = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(validateRepoInput)
  .handler(async ({ context, data }): Promise<RepoPlans> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    return loadRepoPlans(db, getEnv(), ctx)
  })

/** A single plan's full detail (frontmatter + rendered body). */
export const getPlan = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator((data: PlanInput): PlanInput => {
    const base = validateRepoInput(data)
    if (!data?.path || !isPlanPath(data.path)) throw notFound()
    return { ...base, path: data.path }
  })
  .handler(async ({ context, data }): Promise<PlanDetail> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    const detail = await loadPlanDetail(db, getEnv(), ctx, data.path)
    if (!detail) throw notFound()
    return detail
  })
