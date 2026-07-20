import { createFileRoute, Link } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PLAN_STATE_LABELS } from '~/lib/plans/states'
import type { PlanDetail } from '~/lib/plans/types'
import { getPlan } from '~/server/repo.functions'

export const Route = createFileRoute('/repos/$owner/$repo/plan/$')({
  loader: ({ params }): Promise<PlanDetail> =>
    getPlan({
      data: { owner: params.owner, repo: params.repo, path: params._splat ?? '' },
    }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.title} · Plans` : 'Plan' }],
  }),
  component: PlanPage,
})

function PlanPage() {
  const plan = Route.useLoaderData()
  const { owner, repo } = Route.useParams()

  return (
    <section className="plan">
      <p className="crumb">
        <Link to="/">Dashboard</Link> <span aria-hidden>/</span>{' '}
        <Link to="/repos/$owner/$repo" params={{ owner, repo }}>
          {owner}/{repo}
        </Link>{' '}
        <span aria-hidden>/</span>
      </p>

      <header className="plan__head">
        <h1>{plan.title}</h1>
        <dl className="plan__meta">
          <div>
            <dt>State</dt>
            <dd>
              <span className={`tag tag--state tag--${plan.state}`}>
                {PLAN_STATE_LABELS[plan.state]}
              </span>
            </dd>
          </div>
          {plan.status ? (
            <div>
              <dt>Status</dt>
              <dd>{plan.status}</dd>
            </div>
          ) : null}
          {plan.created ? (
            <div>
              <dt>Created</dt>
              <dd>{plan.created}</dd>
            </div>
          ) : null}
          {plan.updated ? (
            <div>
              <dt>Updated</dt>
              <dd>{plan.updated}</dd>
            </div>
          ) : null}
          <div>
            <dt>Path</dt>
            <dd><code>{plan.path}</code></dd>
          </div>
        </dl>
      </header>

      <article className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan.body}</ReactMarkdown>
      </article>
    </section>
  )
}
