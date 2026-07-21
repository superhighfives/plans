import { createFileRoute, Link } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PLAN_STATE_LABELS } from '~/lib/plans/states'
import type { PlanBranchTab, PlanView } from '~/lib/plans/types'
import { getPlanView } from '~/server/repo.functions'

interface PlanSearch {
  pr?: number
}

export const Route = createFileRoute('/repos/$owner/$repo/plan/$')({
  validateSearch: (search: Record<string, unknown>): PlanSearch => {
    const pr = Number(search.pr)
    return Number.isInteger(pr) && pr > 0 ? { pr } : {}
  },
  loaderDeps: ({ search }) => ({ pr: search.pr }),
  loader: ({ params, deps }): Promise<PlanView> =>
    getPlanView({
      data: {
        owner: params.owner,
        repo: params.repo,
        path: params._splat ?? '',
        pr: deps.pr ?? null,
      },
    }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.plan.title} · Plans` : 'Plan' }],
  }),
  component: PlanPage,
})

function PlanPage() {
  const { plan, tabs, activePr } = Route.useLoaderData()
  const { owner, repo, _splat } = Route.useParams()

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
            <dd>
              <code>{plan.path}</code>
            </dd>
          </div>
        </dl>
      </header>

      {tabs.length > 1 ? (
        <BranchTabs
          tabs={tabs}
          activePr={activePr}
          owner={owner}
          repo={repo}
          splat={_splat ?? ''}
        />
      ) : null}

      {activePr != null ? (
        <ViewingBranchNotice tabs={tabs} activePr={activePr} />
      ) : null}

      <article className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan.body}</ReactMarkdown>
      </article>
    </section>
  )
}

function BranchTabs({
  tabs,
  activePr,
  owner,
  repo,
  splat,
}: {
  tabs: PlanBranchTab[]
  activePr: number | null
  owner: string
  repo: string
  splat: string
}) {
  return (
    <nav className="branch-tabs" aria-label="Plan version">
      {tabs.map((tab) => {
        const active =
          tab.kind === 'default' ? activePr == null : tab.number === activePr
        const label = tab.kind === 'default' ? 'main' : `PR #${tab.number}`
        return (
          <Link
            key={tab.kind === 'default' ? 'default' : `pr:${tab.number}`}
            to="/repos/$owner/$repo/plan/$"
            params={{ owner, repo, _splat: splat }}
            search={
              tab.kind === 'default' ? {} : { pr: tab.number ?? undefined }
            }
            className={`branch-tab${active ? ' branch-tab--active' : ''}`}
            title={tab.title ?? undefined}
          >
            <span className="branch-tab__label">{label}</span>
            {tab.changeKind ? (
              <span
                className={`branch-tab__kind branch-tab__kind--${tab.changeKind}`}
              >
                {tab.changeKind === 'moved' ? 'moved' : 'edited'}
              </span>
            ) : null}
            {tab.draft ? (
              <span className="branch-tab__draft">draft</span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

function ViewingBranchNotice({
  tabs,
  activePr,
}: {
  tabs: PlanBranchTab[]
  activePr: number
}) {
  const tab = tabs.find((t) => t.number === activePr)
  if (!tab) return null
  return (
    <p className="branch-notice">
      Viewing this plan as it appears on{' '}
      <a href={tab.url ?? undefined} target="_blank" rel="noreferrer">
        PR #{tab.number}
      </a>
      {tab.title ? ` — ${tab.title}` : ''}. This is the branch version, not
      what’s on the default branch yet.
    </p>
  )
}
