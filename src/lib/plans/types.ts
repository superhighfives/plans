import type { PlanState } from './states'

/** Client-safe shapes returned by the plan server functions. */

export interface PlanSummary {
  /** Full repo path, e.g. plans/ready/foo.md */
  path: string
  state: PlanState
  slug: string
  title: string
  status: string | null
  created: string | null
  updated: string | null
  /** Git blob sha (used as the base sha for conflict-safe writes in Phase 2). */
  bodySha: string
}

export interface PlanDetail extends PlanSummary {
  /** Rendered markdown body (frontmatter stripped). */
  body: string
}

export interface RepoRef {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
  isPrivate: boolean
}

export interface RepoPlans {
  repo: RepoRef
  /** Plans grouped by state, in board order. */
  states: Record<PlanState, PlanSummary[]>
  /** Whether GitHub truncated the tree during scan (very large repo). */
  truncated: boolean
}
