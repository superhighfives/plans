import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { isPlanPath, isPlanState, type PlanState } from '~/lib/plans/states'
import type {
  NewBacklogPreview,
  PlanDetail,
  PlanMovePreview,
  PlanView,
  RepoPlans,
} from '~/lib/plans/types'
import { authMiddleware } from './auth-middleware'
import {
  type CreatePlanResult,
  commitNewBacklog,
  commitPlanMove,
  loadPlanDetail,
  loadPlanSource,
  loadPlanView,
  loadRepoPlans,
  type MovePlanResult,
  type PlanSource,
  proposeNewBacklog,
  proposePlanMove,
  resolveAccessibleRepo,
  type WritePlanResult,
  writePlan,
} from './plans.server'

interface RepoInput {
  owner: string
  repo: string
}

interface PlanInput extends RepoInput {
  path: string
}

interface PlanViewInput extends PlanInput {
  /** Open PR number to view the plan at; omit/null for the default branch. */
  pr: number | null
}

interface UpdatePlanInput extends PlanInput {
  /** The full edited file (frontmatter + body) to commit. */
  content: string
  /** Blob sha the edit started from — the base-SHA conflict guard. */
  baseSha: string
}

interface ProposeMoveInput extends PlanInput {
  /** The lifecycle state to move the plan into. */
  toState: PlanState
  /** Optional extra context to steer the AI rewrite. */
  context: string
}

interface CommitMoveInput extends RepoInput {
  oldPath: string
  newPath: string
  newContent: string
  baseSha: string
}

interface ProposeBacklogInput extends RepoInput {
  /** The rough idea the AI fleshes into a backlog item. */
  idea: string
}

interface CommitBacklogInput extends RepoInput {
  /** Destination path (plans/backlog/<slug>.md) from the preview. */
  path: string
  /** Full proposed file (frontmatter + body) to commit. */
  newContent: string
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

/**
 * A plan resolved at a chosen ref (default branch or an open PR) plus the tabs
 * for every open PR that changes it. Enforces per-user access to the repo.
 */
export const getPlanView = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator((data: PlanViewInput): PlanViewInput => {
    const base = validateRepoInput(data)
    if (!data?.path || !isPlanPath(data.path)) throw notFound()
    const pr =
      data.pr != null && Number.isInteger(data.pr) && data.pr > 0
        ? data.pr
        : null
    return { ...base, path: data.path, pr }
  })
  .handler(async ({ context, data }): Promise<PlanView> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    const view = await loadPlanView(db, getEnv(), ctx, data.path, data.pr)
    if (!view) throw notFound()
    return view
  })

/** The raw file behind a plan, for the editor. Enforces per-user repo access. */
export const getPlanSource = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator((data: PlanInput): PlanInput => {
    const base = validateRepoInput(data)
    if (!data?.path || !isPlanPath(data.path)) throw notFound()
    return { ...base, path: data.path }
  })
  .handler(async ({ context, data }): Promise<PlanSource> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    const source = await loadPlanSource(db, getEnv(), ctx, data.path)
    if (!source) throw notFound()
    return source
  })

/**
 * Commit a hand-edited plan back to the default branch as one App-authored
 * commit, guarded by the base sha. Returns a discriminated result so the UI can
 * distinguish a conflict from an invalid edit without throwing.
 */
export const updatePlan = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: UpdatePlanInput): UpdatePlanInput => {
    const base = validateRepoInput(data)
    if (!data?.path || !isPlanPath(data.path)) throw notFound()
    if (typeof data.content !== 'string' || data.content.length === 0)
      throw new Error('content is required')
    if (typeof data.baseSha !== 'string' || !data.baseSha)
      throw new Error('baseSha is required')
    return {
      ...base,
      path: data.path,
      content: data.content,
      baseSha: data.baseSha,
    }
  })
  .handler(async ({ context, data }): Promise<WritePlanResult> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    return writePlan(
      db,
      getEnv(),
      ctx,
      context.user.id,
      data.path,
      data.content,
      data.baseSha,
    )
  })

/**
 * Draft (but don't commit) an AI move of a plan to a new state. Returns a
 * preview + diff for the user to approve. Enforces per-user repo access.
 */
export const proposeMove = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: ProposeMoveInput): ProposeMoveInput => {
    const base = validateRepoInput(data)
    if (!data?.path || !isPlanPath(data.path)) throw notFound()
    if (!data?.toState || !isPlanState(data.toState))
      throw new Error('a valid toState is required')
    return {
      ...base,
      path: data.path,
      toState: data.toState,
      context: typeof data.context === 'string' ? data.context : '',
    }
  })
  .handler(async ({ context, data }): Promise<PlanMovePreview> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    return proposePlanMove(
      db,
      getEnv(),
      ctx,
      data.path,
      data.toState,
      data.context,
    )
  })

/** Commit an approved move as one atomic commit. Enforces per-user repo access. */
export const commitMove = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: CommitMoveInput): CommitMoveInput => {
    const base = validateRepoInput(data)
    if (!data?.oldPath || !isPlanPath(data.oldPath)) throw notFound()
    if (!data?.newPath || !isPlanPath(data.newPath)) throw notFound()
    if (typeof data.newContent !== 'string' || data.newContent.length === 0)
      throw new Error('newContent is required')
    if (typeof data.baseSha !== 'string' || !data.baseSha)
      throw new Error('baseSha is required')
    return {
      ...base,
      oldPath: data.oldPath,
      newPath: data.newPath,
      newContent: data.newContent,
      baseSha: data.baseSha,
    }
  })
  .handler(async ({ context, data }): Promise<MovePlanResult> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    return commitPlanMove(db, getEnv(), ctx, context.user.id, {
      oldPath: data.oldPath,
      newPath: data.newPath,
      newContent: data.newContent,
      baseSha: data.baseSha,
    })
  })

/**
 * Draft (but don't commit) a new backlog item from a rough idea. Returns a
 * preview (proposed title + body + destination path) for the user to approve.
 * Enforces per-user repo access.
 */
export const proposeBacklogItem = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: ProposeBacklogInput): ProposeBacklogInput => {
    const base = validateRepoInput(data)
    if (typeof data.idea !== 'string' || data.idea.trim().length === 0)
      throw new Error('an idea is required')
    return { ...base, idea: data.idea }
  })
  .handler(async ({ context, data }): Promise<NewBacklogPreview> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    return proposeNewBacklog(db, getEnv(), ctx, data.idea)
  })

/** Commit an approved new backlog item. Enforces per-user repo access. */
export const commitBacklogItem = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: CommitBacklogInput): CommitBacklogInput => {
    const base = validateRepoInput(data)
    if (!data?.path || !isPlanPath(data.path)) throw notFound()
    if (typeof data.newContent !== 'string' || data.newContent.length === 0)
      throw new Error('newContent is required')
    return { ...base, path: data.path, newContent: data.newContent }
  })
  .handler(async ({ context, data }): Promise<CreatePlanResult> => {
    const db = getDb()
    const ctx = await resolveAccessibleRepo(
      db,
      context.user.id,
      data.owner,
      data.repo,
    )
    if (!ctx) throw notFound()
    return commitNewBacklog(db, getEnv(), ctx, context.user.id, {
      path: data.path,
      newContent: data.newContent,
    })
  })
