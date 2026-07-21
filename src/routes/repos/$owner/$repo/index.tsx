import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import type { PlanChange } from '~/lib/plans/diff'
import {
  PLAN_STATE_LABELS,
  PLAN_STATES,
  type PlanState,
} from '~/lib/plans/states'
import type {
  PlanSummary,
  PullRequestActivity,
  RepoPlans,
} from '~/lib/plans/types'
import { getRepoPlans, refreshRepoPlans } from '~/server/repo.functions'

/** A plan heading into a column on a branch (a new plan or a state move). */
interface GhostCard {
  pr: PullRequestActivity
  change: PlanChange
}

/** A branch touching an existing plan in place (modified or removed). */
interface CardBadge {
  pr: PullRequestActivity
  kind: PlanChange['kind']
}

/**
 * Fold open-PR activity into per-column ghost cards (added/moved plans land in
 * their destination state) and per-plan badges (modified/removed plans annotate
 * the existing card, keyed by slug).
 */
function indexBranchActivity(activity: PullRequestActivity[]): {
  ghostsByState: Record<PlanState, GhostCard[]>
  badgesBySlug: Map<string, CardBadge[]>
} {
  const ghostsByState = {
    backlog: [],
    ready: [],
    'in-progress': [],
    done: [],
  } as Record<PlanState, GhostCard[]>
  const badgesBySlug = new Map<string, CardBadge[]>()

  for (const pr of activity) {
    for (const change of pr.changes) {
      if (
        (change.kind === 'added' || change.kind === 'moved') &&
        change.headState
      ) {
        ghostsByState[change.headState].push({ pr, change })
      } else if (change.kind === 'modified' || change.kind === 'removed') {
        const list = badgesBySlug.get(change.slug) ?? []
        list.push({ pr, kind: change.kind })
        badgesBySlug.set(change.slug, list)
      }
    }
  }
  return { ghostsByState, badgesBySlug }
}

export const Route = createFileRoute('/repos/$owner/$repo/')({
  loader: ({ params }): Promise<RepoPlans> =>
    getRepoPlans({ data: { owner: params.owner, repo: params.repo } }),
  head: ({ params }) => ({
    meta: [{ title: `${params.owner}/${params.repo} · Plans` }],
  }),
  component: RepoPage,
})

function RepoPage() {
  const data = Route.useLoaderData()
  const { owner, repo } = Route.useParams()
  const router = useRouter()
  const refresh = useServerFn(refreshRepoPlans)
  const [busy, setBusy] = useState(false)
  // True while the loader re-runs on an already-rendered page (background
  // revalidation after staleTime, or an explicit refresh).
  const revalidating = Route.useMatch({ select: (m) => Boolean(m.isFetching) })
  const refreshing = busy || revalidating

  const total = PLAN_STATES.reduce((n, s) => n + data.states[s].length, 0)
  const { ghostsByState, badgesBySlug } = indexBranchActivity(
    data.branchActivity,
  )
  const activePrs = data.branchActivity.length

  async function onRefresh() {
    setBusy(true)
    try {
      await refresh({ data: { owner, repo } })
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="crumb">
            <Link to="/">Dashboard</Link> <span aria-hidden>/</span>
          </p>
          <h1>{data.repo.fullName}</h1>
          <p className="muted">
            {total} plan{total === 1 ? '' : 's'}
            {data.repo.isPrivate ? ' · private' : ''}
            {activePrs > 0
              ? ` · ${activePrs} open PR${activePrs === 1 ? '' : 's'} touching plans`
              : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? <Spinner /> : null}
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {data.truncated ? (
        <p className="notice">
          This repo’s file tree is very large and GitHub truncated it — some
          plans may be missing.
        </p>
      ) : null}

      {data.branchActivityStatus === 'no-access' ? (
        <p className="notice">
          To show what open PRs are doing to these plans, the Plans GitHub App
          needs <strong>Pull requests: Read</strong> access.{' '}
          <a
            href="https://github.com/settings/installations"
            target="_blank"
            rel="noreferrer"
          >
            Review the app’s permissions
          </a>{' '}
          and accept the update.
        </p>
      ) : null}

      {total === 0 ? (
        <div className="empty">
          <h2>No plans found</h2>
          <p>
            No files matched <code>plans/&lt;state&gt;/*.md</code> with valid
            frontmatter in this repo.
          </p>
        </div>
      ) : (
        <div className="board">
          {PLAN_STATES.map((state) => (
            <StateColumn
              key={state}
              label={PLAN_STATE_LABELS[state]}
              plans={data.states[state]}
              owner={owner}
              repo={repo}
              ghosts={ghostsByState[state]}
              badgesBySlug={badgesBySlug}
              // Done can be long and is history — collapse to the most recent.
              initialLimit={state === 'done' ? 5 : undefined}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function StateColumn({
  label,
  plans,
  owner,
  repo,
  ghosts,
  badgesBySlug,
  initialLimit,
}: {
  label: string
  plans: PlanSummary[]
  owner: string
  repo: string
  /** Added/moved plans headed into this column on a branch. */
  ghosts: GhostCard[]
  /** Modified/removed annotations for existing cards, keyed by plan slug. */
  badgesBySlug: Map<string, CardBadge[]>
  /** If set, show only this many plans until "Show more" is clicked. */
  initialLimit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const collapsible =
    initialLimit != null && !expanded && plans.length > initialLimit
  const visible = collapsible ? plans.slice(0, initialLimit) : plans
  const hidden = plans.length - visible.length

  return (
    <div className="board__col">
      <div className="board__col-head">
        <h2>{label}</h2>
        <span className="count">{plans.length}</span>
      </div>
      {plans.length === 0 && ghosts.length === 0 ? (
        <p className="board__empty">Empty</p>
      ) : (
        <ul className="plan-list">
          {ghosts.map((ghost) => (
            <li key={`ghost:${ghost.pr.number}:${ghost.change.slug}`}>
              <GhostCardItem ghost={ghost} />
            </li>
          ))}
          {visible.map((plan) => (
            <li key={plan.path}>
              <Link
                to="/repos/$owner/$repo/plan/$"
                params={{ owner, repo, _splat: plan.path }}
                className="plan-card"
              >
                <span className="plan-card__title">{plan.title}</span>
                {plan.status ? (
                  <span className="plan-card__status">{plan.status}</span>
                ) : null}
                <PlanCardBadges badges={badgesBySlug.get(plan.slug)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <button
          type="button"
          className="board__more"
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more
        </button>
      ) : null}
    </div>
  )
}

function GhostCardItem({ ghost }: { ghost: GhostCard }) {
  const { pr, change } = ghost
  const hint =
    change.kind === 'added'
      ? 'New plan'
      : change.baseState
        ? `from ${PLAN_STATE_LABELS[change.baseState]}`
        : 'Moved'
  return (
    <a
      className="ghost-card"
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={`${pr.title} — PR #${pr.number}`}
    >
      <span className="ghost-card__title">{change.slug}</span>
      <span className="ghost-card__meta">
        {hint} · #{pr.number}
        {pr.draft ? ' · draft' : ''}
      </span>
    </a>
  )
}

function PlanCardBadges({ badges }: { badges: CardBadge[] | undefined }) {
  if (!badges || badges.length === 0) return null
  return (
    <span className="plan-card__badges">
      {badges.map((badge) => (
        <span
          key={`${badge.pr.number}:${badge.kind}`}
          className={`pr-badge pr-badge--${badge.kind}`}
          title={`${badge.kind === 'removed' ? 'Removed' : 'Modified'} in “${badge.pr.title}” (PR #${badge.pr.number})`}
        >
          {badge.kind === 'removed' ? '−' : '±'} #{badge.pr.number}
        </span>
      ))}
    </span>
  )
}

function Spinner() {
  return <span className="spinner" aria-hidden />
}
