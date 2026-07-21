import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { PLAN_STATE_LABELS, PLAN_STATES } from '~/lib/plans/states'
import type { PlanSummary, RepoPlans } from '~/lib/plans/types'
import { getRepoPlans, refreshRepoPlans } from '~/server/repo.functions'

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
  initialLimit,
}: {
  label: string
  plans: PlanSummary[]
  owner: string
  repo: string
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
      {plans.length === 0 ? (
        <p className="board__empty">Empty</p>
      ) : (
        <ul className="plan-list">
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

function Spinner() {
  return <span className="spinner" aria-hidden />
}
