import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { PLAN_STATES, PLAN_STATE_LABELS } from '~/lib/plans/states'
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
        <button className="btn btn--ghost" onClick={onRefresh} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {data.truncated ? (
        <p className="notice">
          This repo’s file tree is very large and GitHub truncated it — some plans
          may be missing.
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
}: {
  label: string
  plans: PlanSummary[]
  owner: string
  repo: string
}) {
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
          {plans.map((plan) => (
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
    </div>
  )
}
