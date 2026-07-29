import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useAgent } from 'agents/react'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PlanChange } from '~/lib/plans/diff'
import {
  PLAN_STATE_LABELS,
  PLAN_STATES,
  type PlanState,
} from '~/lib/plans/states'
import type {
  NewBacklogPreview,
  PlanSummary,
  PullRequestActivity,
  RepoPlans,
} from '~/lib/plans/types'
import {
  commitBacklogItem,
  getRepoPlans,
  proposeBacklogItem,
  refreshRepoPlans,
} from '~/server/repo.functions'

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
  const [creating, setCreating] = useState(false)
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
        <div className="page-head__actions">
          <button
            type="button"
            className="btn"
            onClick={() => setCreating((v) => !v)}
          >
            New backlog item
          </button>
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
      </div>

      {creating ? (
        <NewBacklogItem
          owner={owner}
          repo={repo}
          onClose={() => setCreating(false)}
        />
      ) : null}

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

/**
 * Slice-1 connectivity check for the Flue agent: open a WebSocket to this repo's
 * agent instance, send a ping once connected, and show the echo. Proves the
 * transport + auth gate end to end. Replaced by the real conversation UI in a
 * later slice.
 */
function FluePing({ owner, repo }: { owner: string; repo: string }) {
  const [echo, setEcho] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const flue = useAgent({
    agent: 'flue-agent',
    name: `${owner}~${repo}`,
    onMessage: (e) => setEcho(typeof e.data === 'string' ? e.data : ''),
    onError: () => setError(true),
  })

  useEffect(() => {
    let cancelled = false
    flue.ready
      .then(() => {
        if (!cancelled) flue.send(JSON.stringify({ type: 'ping' }))
      })
      .catch(() => setError(true))
    return () => {
      cancelled = true
    }
  }, [flue])

  return (
    <p className="muted" style={{ fontSize: 13 }}>
      Flue: {error ? 'offline' : echo ? `online · echo ${echo}` : 'connecting…'}
    </p>
  )
}

/**
 * Draft a new backlog item with AI. The user types a rough idea, Claude proposes
 * a title + body, and the rendered plan is shown for approval before anything is
 * committed into plans/backlog/ (mirrors the Phase 3 move preview path).
 */
function NewBacklogItem({
  owner,
  repo,
  onClose,
}: {
  owner: string
  repo: string
  onClose: () => void
}) {
  const router = useRouter()
  const [idea, setIdea] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [preview, setPreview] = useState<NewBacklogPreview | null>(null)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function draft() {
    if (idea.trim().length === 0) return
    setDrafting(true)
    setError(null)
    setPreview(null)
    try {
      const result = await proposeBacklogItem({ data: { owner, repo, idea } })
      setPreview(result)
    } catch {
      setError(
        "Couldn't draft the item. The AI Gateway may not be configured, or the request failed — try again.",
      )
    } finally {
      setDrafting(false)
    }
  }

  async function approve() {
    if (!preview) return
    setCommitting(true)
    setError(null)
    try {
      const result = await commitBacklogItem({
        data: {
          owner,
          repo,
          path: preview.path,
          newContent: preview.newContent,
        },
      })
      if (result.ok) {
        await router.navigate({
          to: '/repos/$owner/$repo/plan/$',
          params: { owner, repo, _splat: result.path },
        })
        await router.invalidate()
        return
      }
      setError(
        `A file already exists at ${preview.path}. Draft again to get a fresh filename.`,
      )
    } catch {
      setError("Couldn't commit the item — try again.")
    } finally {
      setCommitting(false)
    }
  }

  if (preview) {
    return (
      <div className="move">
        <h2 className="move__title">New backlog item — preview</h2>
        <dl className="plan__meta">
          <div>
            <dt>Title</dt>
            <dd>{preview.title}</dd>
          </div>
          <div>
            <dt>Path</dt>
            <dd>
              <code>{preview.path}</code>
            </dd>
          </div>
        </dl>
        <article className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {preview.body}
          </ReactMarkdown>
        </article>
        {error ? <p className="plan-editor__error">{error}</p> : null}
        <div className="plan-editor__bar">
          <button
            type="button"
            className="btn"
            onClick={approve}
            disabled={committing}
          >
            {committing ? 'Committing…' : 'Approve & commit'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPreview(null)}
            disabled={committing}
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="move">
      <h2 className="move__title">New backlog item</h2>
      <FluePing owner={owner} repo={repo} />
      <p className="move__hint">
        Describe a rough idea. Claude drafts a backlog entry — with a title and
        a sketch — then shows it to you before anything is committed.
      </p>
      <textarea
        className="move__context"
        placeholder="A rough idea for something to work on…"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
      />
      {error ? <p className="plan-editor__error">{error}</p> : null}
      <div className="plan-editor__bar">
        <button
          type="button"
          className="btn"
          onClick={draft}
          disabled={drafting || idea.trim().length === 0}
        >
          {drafting ? 'Drafting…' : 'Draft with AI'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClose}
          disabled={drafting}
        >
          Cancel
        </button>
      </div>
    </div>
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
              <GhostCardItem ghost={ghost} owner={owner} repo={repo} />
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

function GhostCardItem({
  ghost,
  owner,
  repo,
}: {
  ghost: GhostCard
  owner: string
  repo: string
}) {
  const { pr, change } = ghost
  const hint =
    change.kind === 'added'
      ? 'New plan'
      : change.baseState
        ? `from ${PLAN_STATE_LABELS[change.baseState]}`
        : 'Moved'
  const inner = (
    <>
      <span className="ghost-card__title">{change.slug}</span>
      <span className="ghost-card__meta">
        {hint} · #{pr.number}
        {pr.draft ? ' · draft' : ''}
      </span>
    </>
  )

  // A moved plan still exists on the default branch, so we can open it in-app
  // with the PR tab preselected. A newly-added plan only exists on the branch —
  // there's nothing on the default branch to open — so link out to the PR.
  if (change.kind === 'moved' && change.basePath) {
    return (
      <Link
        to="/repos/$owner/$repo/plan/$"
        params={{ owner, repo, _splat: change.basePath }}
        search={{ pr: pr.number }}
        className="ghost-card"
        title={`${pr.title} — PR #${pr.number}`}
      >
        {inner}
      </Link>
    )
  }
  return (
    <a
      className="ghost-card"
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={`${pr.title} — PR #${pr.number}`}
    >
      {inner}
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
          title={`This plan is ${badge.kind === 'removed' ? 'deleted' : 'edited'} in the open pull request “${badge.pr.title}” (PR #${badge.pr.number})`}
        >
          {badge.kind === 'removed' ? 'Removed in' : 'Edited in'} #
          {badge.pr.number}
        </span>
      ))}
    </span>
  )
}

function Spinner() {
  return <span className="spinner" aria-hidden />
}
