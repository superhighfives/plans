/** The four plan states, in board order. Directory name === state id. */
export const PLAN_STATES = ['backlog', 'ready', 'in-progress', 'done'] as const

export type PlanState = (typeof PLAN_STATES)[number]

export const PLAN_STATE_LABELS: Record<PlanState, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  'in-progress': 'In progress',
  done: 'Done',
}

const PLAN_STATE_SET = new Set<string>(PLAN_STATES)

export function isPlanState(value: string): value is PlanState {
  return PLAN_STATE_SET.has(value)
}

/**
 * Matches a top-level plan file: plans/<state>/<file>.md
 *
 * Per the v1 "detect-and-skip" decision, only top-level `plans/` with the
 * skill's state directories is recognized. Files directly in `plans/`, nested
 * deeper, or in unknown subdirectories are ignored.
 */
const PLAN_PATH_RE = /^plans\/(backlog|ready|in-progress|done)\/[^/]+\.md$/

export interface PlanPathInfo {
  state: PlanState
  /** File name without extension. */
  slug: string
}

export function parsePlanPath(path: string): PlanPathInfo | null {
  const match = PLAN_PATH_RE.exec(path)
  if (!match) return null
  const state = match[1] as PlanState
  const file = path.slice(path.lastIndexOf('/') + 1)
  const slug = file.replace(/\.md$/, '')
  return { state, slug }
}

export function isPlanPath(path: string): boolean {
  return PLAN_PATH_RE.test(path)
}
