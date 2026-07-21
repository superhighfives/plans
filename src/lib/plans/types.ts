import type { PlanChange } from './diff'
import type { PlanState } from './states'
import type { UnifiedDiff } from './text-diff'

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

/** One selectable ref for a plan in the detail view: the default branch or a PR. */
export interface PlanBranchTab {
  kind: 'default' | 'pr'
  /** PR number, or null for the default branch. */
  number: number | null
  /** PR title, or null for the default branch. */
  title: string | null
  /** github.com PR URL, or null for the default branch. */
  url: string | null
  draft: boolean
  /** How this PR changes the plan ('moved' | 'modified'); null for default. */
  changeKind: PlanChange['kind'] | null
}

/** A plan resolved at a chosen ref, plus the other refs it can be viewed at. */
export interface PlanView {
  /** The plan content at the active ref. */
  plan: PlanDetail
  /** The active PR number, or null when viewing the default branch. */
  activePr: number | null
  /** The default branch tab plus one per open PR that changes this plan. */
  tabs: PlanBranchTab[]
  /**
   * Unified diff of the plan body, default branch → active PR. Null on the
   * default tab; present (possibly with zero hunks, e.g. a pure state move) when
   * a PR is active.
   */
  diff: UnifiedDiff | null
  /** 'no-access' when the App lacks pull_requests:read (tabs limited to main). */
  branchActivityStatus: BranchActivityStatus
}

export interface RepoRef {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
  isPrivate: boolean
}

/** How one open PR changes this repo's plans, relative to the default branch. */
export interface PullRequestActivity {
  number: number
  title: string
  authorLogin: string | null
  /** github.com PR URL. */
  url: string
  draft: boolean
  /** The PR's head branch name. */
  headRef: string
  updatedAt: string
  /** The plan-level changes this PR introduces (added / moved / modified / removed). */
  changes: PlanChange[]
}

/**
 * Whether branch activity could be read. `no-access` means the App installation
 * hasn't granted `pull_requests: read` yet — the UI shows a "grant access"
 * notice instead of silently hiding the feature.
 */
export type BranchActivityStatus = 'ok' | 'no-access'

export interface RepoPlans {
  repo: RepoRef
  /** Plans grouped by state, in board order. */
  states: Record<PlanState, PlanSummary[]>
  /** Whether GitHub truncated the tree during scan (very large repo). */
  truncated: boolean
  /** Open PRs that touch this repo's plans (empty when none or no access). */
  branchActivity: PullRequestActivity[]
  branchActivityStatus: BranchActivityStatus
}
