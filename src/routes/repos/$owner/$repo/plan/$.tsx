import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stripRedundantHeading } from '~/lib/plans/body'
import { parseFrontmatter } from '~/lib/plans/frontmatter'
import {
  PLAN_STATE_LABELS,
  PLAN_STATES,
  type PlanState,
} from '~/lib/plans/states'
import { type UnifiedDiff, unifiedDiff } from '~/lib/plans/text-diff'
import type {
  PlanBranchTab,
  PlanMovePreview,
  PlanView,
} from '~/lib/plans/types'
import {
  commitMove,
  getPlanSource,
  getPlanView,
  proposeMove,
  updatePlan,
} from '~/server/repo.functions'

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
  const { plan, tabs, activePr, diff } = Route.useLoaderData()
  const { owner, repo, _splat } = Route.useParams()
  const path = _splat ?? ''
  const [editing, setEditing] = useState(false)
  const hasDiff = diff != null && diff.hunks.length > 0
  // The header panel already shows the title + state/status/dates, so drop the
  // body's leading duplicate heading/metadata for display.
  const displayBody = stripRedundantHeading(plan.body, plan.title)
  // Editing only applies to the default branch — a PR view is read-only.
  const canEdit = activePr == null

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
        <div className="plan__title-row">
          <h1>{plan.title}</h1>
          {canEdit && !editing ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          ) : null}
        </div>
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

      {!editing && tabs.length > 1 ? (
        <BranchTabs
          tabs={tabs}
          activePr={activePr}
          owner={owner}
          repo={repo}
          splat={_splat ?? ''}
        />
      ) : null}

      {!editing && activePr != null ? (
        <ViewingBranchNotice tabs={tabs} activePr={activePr} />
      ) : null}

      {editing ? (
        <PlanEditor
          owner={owner}
          repo={repo}
          path={path}
          title={plan.title}
          onClose={() => setEditing(false)}
        />
      ) : activePr != null && hasDiff && diff ? (
        <PlanBody body={displayBody} diff={diff} />
      ) : (
        <>
          {activePr != null && diff && !hasDiff ? (
            <p className="branch-notice">
              No changes to the plan body on this branch — the difference is the
              state/status move shown above.
            </p>
          ) : null}
          <article className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayBody}
            </ReactMarkdown>
          </article>
        </>
      )}

      {!editing && activePr == null ? (
        <PlanMoveControl
          owner={owner}
          repo={repo}
          path={path}
          fromState={plan.state}
        />
      ) : null}
    </section>
  )
}

/**
 * Move a plan to another lifecycle state with an AI-drafted rewrite. The user
 * picks a target state (plus optional context), Claude drafts the updated plan,
 * and the diff is shown for approval before anything is committed.
 */
function PlanMoveControl({
  owner,
  repo,
  path,
  fromState,
}: {
  owner: string
  repo: string
  path: string
  fromState: PlanState
}) {
  const router = useRouter()
  const [context, setContext] = useState('')
  const [drafting, setDrafting] = useState<PlanState | null>(null)
  const [preview, setPreview] = useState<PlanMovePreview | null>(null)
  // The proposed file, editable before commit. Seeded from the AI draft.
  const [content, setContent] = useState('')
  const [previewMode, setPreviewMode] = useState<'diff' | 'edit'>('diff')
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targets = PLAN_STATES.filter((s) => s !== fromState)

  async function draft(toState: PlanState) {
    setDrafting(toState)
    setError(null)
    setPreview(null)
    try {
      const result = await proposeMove({
        data: { owner, repo, path, toState, context },
      })
      setPreview(result)
      setContent(result.newContent)
      setPreviewMode('diff')
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setError(
        `Couldn't draft the move. The AI Gateway may not be configured, or the request failed — try again. (${detail})`,
      )
    } finally {
      setDrafting(null)
    }
  }

  async function approve() {
    if (!preview) return
    setCommitting(true)
    setError(null)
    try {
      const result = await commitMove({
        data: {
          owner,
          repo,
          oldPath: preview.oldPath,
          newPath: preview.newPath,
          newContent: content,
          baseSha: preview.baseSha,
        },
      })
      if (result.ok) {
        await router.navigate({
          to: '/repos/$owner/$repo/plan/$',
          params: { owner, repo, _splat: result.newPath },
        })
        await router.invalidate()
        return
      }
      setError(
        result.reason === 'destination-exists'
          ? `A different plan already exists at ${preview.newPath}. Rename or remove it before moving this one there.`
          : 'This plan changed on GitHub since the move was drafted. Discard and draft again.',
      )
    } catch {
      setError("Couldn't commit the move — try again.")
    } finally {
      setCommitting(false)
    }
  }

  if (preview) {
    // Re-diff live against the (possibly edited) content so the diff always
    // reflects what will actually be committed.
    const liveDiff = unifiedDiff(preview.oldContent, content)
    const hasDiff = liveDiff.hunks.length > 0
    return (
      <div className="move">
        <h2 className="move__title">
          Move to {PLAN_STATE_LABELS[preview.toState]} — preview
        </h2>
        {preview.destinationExists ? (
          <div className="move__warn move__warn--block">
            <strong>A plan already exists at {preview.newPath}.</strong> Moving
            this one there would overwrite it, so it's blocked. Rename or remove
            the existing plan first.
          </div>
        ) : null}
        {preview.warnings.length > 0 ? (
          <div className="move__warn">
            <strong>Open questions remain</strong> — you can still move it, but
            these looked unresolved:
            <ul>
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <nav className="branch-tabs" aria-label="Preview mode">
          <button
            type="button"
            className={`branch-tab${previewMode === 'diff' ? ' branch-tab--active' : ''}`}
            aria-pressed={previewMode === 'diff'}
            onClick={() => setPreviewMode('diff')}
          >
            Diff
          </button>
          <button
            type="button"
            className={`branch-tab${previewMode === 'edit' ? ' branch-tab--active' : ''}`}
            aria-pressed={previewMode === 'edit'}
            onClick={() => setPreviewMode('edit')}
          >
            Edit
          </button>
        </nav>
        {previewMode === 'edit' ? (
          <textarea
            className="plan-editor__area"
            value={content}
            spellCheck={false}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Proposed plan source"
          />
        ) : hasDiff ? (
          <DiffView diff={liveDiff} />
        ) : (
          <p className="branch-notice">
            No textual changes — only the state and status move.
          </p>
        )}
        {error ? <p className="plan-editor__error">{error}</p> : null}
        <div className="plan-editor__bar">
          <button
            type="button"
            className="btn"
            onClick={approve}
            disabled={committing || preview.destinationExists}
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
      <h2 className="move__title">Move with AI</h2>
      <p className="move__hint">
        Claude rewrites the plan for its new state, then shows you a diff to
        approve before anything is committed.
      </p>
      <textarea
        className="move__context"
        placeholder="Optional: extra context to steer the rewrite…"
        value={context}
        onChange={(e) => setContext(e.target.value)}
      />
      <div className="move__targets">
        {targets.map((s) => (
          <button
            key={s}
            type="button"
            className="btn btn--ghost"
            onClick={() => draft(s)}
            disabled={drafting != null}
          >
            {drafting === s ? 'Drafting…' : `→ ${PLAN_STATE_LABELS[s]}`}
          </button>
        ))}
      </div>
      {error ? <p className="plan-editor__error">{error}</p> : null}
    </div>
  )
}

/**
 * Hand-edit a plan's raw markdown and commit it. Loads the exact file bytes
 * (so every frontmatter key round-trips), then writes back guarded by the blob
 * sha it started from — a stale sha surfaces as a conflict instead of clobbering.
 */
function PlanEditor({
  owner,
  repo,
  path,
  title,
  onClose,
}: {
  owner: string
  repo: string
  path: string
  title: string
  onClose: () => void
}) {
  const router = useRouter()
  const [source, setSource] = useState<string | null>(null)
  const [baseSha, setBaseSha] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'editor' | 'preview'>('editor')

  useEffect(() => {
    let active = true
    getPlanSource({ data: { owner, repo, path } })
      .then((src) => {
        if (!active) return
        setSource(src.content)
        setBaseSha(src.sha)
      })
      .catch(() => {
        if (active) setError("Couldn't load this plan for editing.")
      })
    return () => {
      active = false
    }
  }, [owner, repo, path])

  async function save() {
    if (source == null || baseSha == null) return
    setSaving(true)
    setError(null)
    try {
      const result = await updatePlan({
        data: { owner, repo, path, content: source, baseSha },
      })
      if (result.ok) {
        await router.invalidate()
        onClose()
        return
      }
      setError(
        result.reason === 'conflict'
          ? 'This plan changed on GitHub since you started editing. Reload to get the latest, then re-apply your changes.'
          : 'A plan needs a title in its frontmatter.',
      )
    } catch {
      setError("Couldn't save — the commit didn't go through. Try again.")
    } finally {
      setSaving(false)
    }
  }

  if (error && source == null) {
    return <p className="branch-notice">{error}</p>
  }
  if (source == null) {
    return <p className="branch-notice">Loading editor…</p>
  }

  // Preview the edited buffer exactly as the detail view would render it: parse
  // the current frontmatter and drop the leading duplicate heading.
  const parsed = parseFrontmatter(source)
  const previewBody = stripRedundantHeading(
    parsed.content,
    parsed.data.title ?? title,
  )

  return (
    <div className="plan-editor">
      <nav className="branch-tabs" aria-label="Editor mode">
        <button
          type="button"
          className={`branch-tab${mode === 'editor' ? ' branch-tab--active' : ''}`}
          aria-pressed={mode === 'editor'}
          onClick={() => setMode('editor')}
        >
          Editor
        </button>
        <button
          type="button"
          className={`branch-tab${mode === 'preview' ? ' branch-tab--active' : ''}`}
          aria-pressed={mode === 'preview'}
          onClick={() => setMode('preview')}
        >
          Preview
        </button>
      </nav>
      {mode === 'editor' ? (
        <textarea
          className="plan-editor__area"
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          aria-label="Plan markdown source"
        />
      ) : (
        <article className="markdown plan-editor__preview">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {previewBody}
          </ReactMarkdown>
        </article>
      )}
      {error ? <p className="plan-editor__error">{error}</p> : null}
      <div className="plan-editor__bar">
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Commit to main'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function PlanBody({ body, diff }: { body: string; diff: UnifiedDiff }) {
  const [mode, setMode] = useState<'diff' | 'rendered'>('diff')
  return (
    <div className="plan-body">
      <div className="plan-body__bar">
        <div className="diffstat">
          <span className="diffstat__add">+{diff.additions}</span>{' '}
          <span className="diffstat__del">−{diff.deletions}</span>
        </div>
        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'diff'}
            className={`segmented__btn${mode === 'diff' ? ' segmented__btn--active' : ''}`}
            onClick={() => setMode('diff')}
          >
            Diff
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'rendered'}
            className={`segmented__btn${mode === 'rendered' ? ' segmented__btn--active' : ''}`}
            onClick={() => setMode('rendered')}
          >
            Rendered
          </button>
        </div>
      </div>

      {mode === 'diff' ? (
        <DiffView diff={diff} />
      ) : (
        <article className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
      )}
    </div>
  )
}

function DiffView({ diff }: { diff: UnifiedDiff }) {
  return (
    <div className="diff">
      {diff.hunks.map((hunk) => (
        <table
          className="diff__hunk"
          key={`${hunk.baseStart}:${hunk.headStart}`}
        >
          <tbody>
            <tr className="diff__row diff__row--hunk">
              <td className="diff__gutter" />
              <td className="diff__gutter" />
              <td className="diff__code">
                @@ -{hunk.baseStart},{hunk.baseLines} +{hunk.headStart},
                {hunk.headLines} @@
              </td>
            </tr>
            {hunk.lines.map((line) => (
              <tr
                className={`diff__row diff__row--${line.type}`}
                key={`${line.type}:${line.baseNo ?? 'x'}:${line.headNo ?? 'x'}`}
              >
                <td className="diff__gutter">{line.baseNo ?? ''}</td>
                <td className="diff__gutter">{line.headNo ?? ''}</td>
                <td className="diff__code">
                  <span className="diff__sign">
                    {line.type === 'add'
                      ? '+'
                      : line.type === 'del'
                        ? '−'
                        : ' '}
                  </span>
                  {line.text || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
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
