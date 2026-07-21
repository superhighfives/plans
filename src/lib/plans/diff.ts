import { type PlanState, parsePlanPath } from './states'

/**
 * Pure plan-tree diffing: given the plan files on a base branch (what the board
 * currently shows) and on a head branch (an open PR), classify how each plan
 * differs. This is the core that drives the board's ghost cards / badges and the
 * detail view's branch tabs — kept side-effect-free so it's cheap to unit test.
 *
 * Plans are identified by slug (the filename without `.md`), so the same plan
 * moving between state directories reads as a single "moved" change rather than
 * an add + remove.
 */

export interface PlanEntry {
  /** Full repo path, e.g. plans/ready/foo.md */
  path: string
  /** Git blob sha of the file. */
  sha: string
}

export type PlanChangeKind = 'added' | 'moved' | 'modified' | 'removed'

export interface PlanChange {
  kind: PlanChangeKind
  slug: string
  /** Path/state on the head branch. Null when the plan was removed. */
  headPath: string | null
  headState: PlanState | null
  /** Path/state on the base branch. Null when the plan is newly added. */
  basePath: string | null
  baseState: PlanState | null
}

interface IndexedPlan {
  slug: string
  path: string
  sha: string
  state: PlanState
}

/** Index plan entries by slug, ignoring non-plan paths. First path per slug wins. */
function indexBySlug(entries: PlanEntry[]): Map<string, IndexedPlan> {
  const map = new Map<string, IndexedPlan>()
  for (const entry of entries) {
    const info = parsePlanPath(entry.path)
    if (!info) continue
    if (!map.has(info.slug)) {
      map.set(info.slug, {
        slug: info.slug,
        path: entry.path,
        sha: entry.sha,
        state: info.state,
      })
    }
  }
  return map
}

/**
 * Compare a head branch's plans against the base branch's plans. Returns one
 * change per plan that differs; unchanged plans are omitted.
 *
 * - `added`    — slug exists on head but not base (new plan on the branch).
 * - `moved`    — same slug, different state directory (e.g. in-progress → done).
 * - `modified` — same slug and state, different blob sha (edited in place).
 * - `removed`  — slug exists on base but not head (deleted on the branch).
 */
export function diffPlanTrees(
  base: PlanEntry[],
  head: PlanEntry[],
): PlanChange[] {
  const baseMap = indexBySlug(base)
  const headMap = indexBySlug(head)
  const changes: PlanChange[] = []

  for (const [slug, h] of headMap) {
    const b = baseMap.get(slug)
    if (!b) {
      changes.push({
        kind: 'added',
        slug,
        headPath: h.path,
        headState: h.state,
        basePath: null,
        baseState: null,
      })
    } else if (h.state !== b.state) {
      changes.push({
        kind: 'moved',
        slug,
        headPath: h.path,
        headState: h.state,
        basePath: b.path,
        baseState: b.state,
      })
    } else if (h.sha !== b.sha) {
      changes.push({
        kind: 'modified',
        slug,
        headPath: h.path,
        headState: h.state,
        basePath: b.path,
        baseState: b.state,
      })
    }
  }

  for (const [slug, b] of baseMap) {
    if (headMap.has(slug)) continue
    changes.push({
      kind: 'removed',
      slug,
      headPath: null,
      headState: null,
      basePath: b.path,
      baseState: b.state,
    })
  }

  return changes
}
