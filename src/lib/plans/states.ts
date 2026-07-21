/**
 * The canonical definition of the plan lifecycle — the single source of truth
 * shared with the `planning` skill (`skills/planning/SKILL.md`). Everything
 * below (the ordered id list, UI labels, frontmatter `status` values, and the
 * path matcher) is derived from `PLAN_STATE_DEFS`; nothing else hardcodes a
 * state. `states.skill.test.ts` asserts the skill's prose agrees with this.
 *
 * Directory name === state id. Note that the frontmatter `status` value is not
 * always the UI label: `in-progress` shows as "In progress" but writes
 * `In Progress`, and `done` shows as "Done" but writes `Complete`.
 */
export interface PlanStateDef {
  /** State id === subdirectory name under `plans/`. */
  id: string
  /** Label shown in the UI. */
  label: string
  /** The value written to a plan's `status` frontmatter field. */
  status: string
  /** One-line lifecycle description, mirrored by the skill. */
  description: string
}

/** The four plan states, in board order. */
export const PLAN_STATE_DEFS = [
  {
    id: 'backlog',
    label: 'Backlog',
    status: 'Backlog',
    description: 'rough ideas, unscoped. Not ready to work on.',
  },
  {
    id: 'ready',
    label: 'Ready',
    status: 'Ready',
    description: 'fully specced. Anyone (human or agent) could pick it up.',
  },
  {
    id: 'in-progress',
    label: 'In progress',
    status: 'In Progress',
    description: 'actively being implemented. Updated as decisions are made.',
  },
  {
    id: 'done',
    label: 'Done',
    status: 'Complete',
    description: 'shipped. Includes an accurate record of what was built.',
  },
] as const satisfies readonly PlanStateDef[]

export type PlanState = (typeof PLAN_STATE_DEFS)[number]['id']

/** State ids in board order. Directory name === state id. */
export const PLAN_STATES = PLAN_STATE_DEFS.map((s) => s.id) as PlanState[]

export const PLAN_STATE_LABELS = Object.fromEntries(
  PLAN_STATE_DEFS.map((s) => [s.id, s.label]),
) as Record<PlanState, string>

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
const PLAN_PATH_RE = new RegExp(
  `^plans/(${PLAN_STATES.join('|')})/[^/]+\\.md$`,
)

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
