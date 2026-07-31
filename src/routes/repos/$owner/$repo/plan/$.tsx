import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useAgent } from 'agents/react'
import { useEffect, useRef, useState } from 'react'
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
  VerifyPlanMoveResult,
} from '~/lib/plans/types'
import {
  commitMove,
  getPlanSource,
  getPlanView,
  getVerifyMoveStatus,
  startVerifyMove,
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

/** A message Flue can send back over the move draft conversation's WebSocket. */
interface FlueMoveMessage {
  type?: string
  question?: string
  error?: string
  title?: string
  fromState?: PlanState
  toState?: PlanState
  oldPath?: string
  newPath?: string
  oldContent?: string
  newContent?: string
  baseSha?: string
  diff?: UnifiedDiff
  warnings?: string[]
  destinationExists?: boolean
}

/**
 * Move a plan to another lifecycle state conversationally with Flue. The user
 * picks a target state (plus optional context); Flue (grounded in the repo's
 * cached codebase context) either asks a clarifying question — answered
 * inline, looping until it has enough — or rewrites the body straight away.
 * The diff is then shown for approval before anything is committed (committing
 * still goes through the existing `commitMove` path, unchanged).
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
  // Which target the author picked — kept through a question/answer round so
  // the question view can still say what it's moving toward.
  const [draftingTarget, setDraftingTarget] = useState<PlanState | null>(null)
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [preview, setPreview] = useState<PlanMovePreview | null>(null)
  // The proposed file, editable before commit. Seeded from the AI draft.
  const [content, setContent] = useState('')
  const [previewMode, setPreviewMode] = useState<'diff' | 'edit'>('diff')
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // "Move to done" verification (slice 5): clone into a Sandbox, run the
  // repo's own test/build scripts, gate the commit on the result.
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyPlanMoveResult | null>(
    null,
  )
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [overrideVerify, setOverrideVerify] = useState(false)

  const targets = PLAN_STATES.filter((s) => s !== fromState)

  const mountedRef = useRef(true)
  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  function resetVerify() {
    setVerifying(false)
    setVerifyResult(null)
    setVerifyError(null)
    setOverrideVerify(false)
  }

  async function runVerify() {
    setVerifying(true)
    setVerifyError(null)
    setVerifyResult(null)
    setOverrideVerify(false)
    try {
      const { instanceId } = await startVerifyMove({ data: { owner, repo } })
      // Poll until the workflow finishes — clone + install + test/build can
      // take minutes, well past a single request.
      while (mountedRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        if (!mountedRef.current) break
        const status = await getVerifyMoveStatus({
          data: { owner, repo, instanceId },
        })
        if (status.status === 'complete') {
          setVerifyResult(status.result)
          break
        }
        if (status.status === 'errored') {
          setVerifyError(status.message)
          break
        }
      }
    } catch {
      if (mountedRef.current)
        setVerifyError("Couldn't run verification — try again.")
    } finally {
      if (mountedRef.current) setVerifying(false)
    }
  }

  const flue = useAgent({
    agent: 'flue-agent',
    name: `${owner}~${repo}`,
    onMessage: (e) => {
      let msg: FlueMoveMessage
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '{}')
      } catch {
        setBusy(false)
        setError('Flue sent something unreadable — try again.')
        return
      }
      if (msg.type === 'question' && msg.question) {
        setBusy(false)
        setQuestion(msg.question)
      } else if (msg.type === 'move_preview') {
        setBusy(false)
        setQuestion(null)
        setDraftingTarget(null)
        const result: PlanMovePreview = {
          title: msg.title ?? '',
          fromState: msg.fromState ?? fromState,
          toState: msg.toState ?? fromState,
          oldPath: msg.oldPath ?? path,
          newPath: msg.newPath ?? path,
          oldContent: msg.oldContent ?? '',
          newContent: msg.newContent ?? '',
          baseSha: msg.baseSha ?? '',
          diff: msg.diff ?? unifiedDiff('', ''),
          warnings: msg.warnings ?? [],
          destinationExists: msg.destinationExists ?? false,
        }
        setPreview(result)
        setContent(result.newContent)
        setPreviewMode('diff')
        resetVerify()
      } else if (msg.type === 'error') {
        setBusy(false)
        setError("Flue couldn't draft the move — try again.")
      }
    },
    onError: () => {
      setBusy(false)
      setError('Lost connection to Flue — try again.')
    },
  })

  async function draft(toState: PlanState) {
    setDraftingTarget(toState)
    setBusy(true)
    setError(null)
    setPreview(null)
    setQuestion(null)
    resetVerify()
    try {
      await flue.ready
      flue.send(JSON.stringify({ type: 'draft_move', path, toState, context }))
    } catch {
      setBusy(false)
      setDraftingTarget(null)
      setError("Couldn't reach Flue — try again.")
    }
  }

  async function sendAnswer() {
    if (answer.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      await flue.ready
      flue.send(JSON.stringify({ type: 'answer', answer }))
      setAnswer('')
    } catch {
      setBusy(false)
      setError("Couldn't reach Flue — try again.")
    }
  }

  function cancelDraft() {
    setQuestion(null)
    setDraftingTarget(null)
    setAnswer('')
    setError(null)
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
        {preview.toState === 'done' ? (
          <VerifyMoveControl
            verifying={verifying}
            result={verifyResult}
            error={verifyError}
            override={overrideVerify}
            onRun={runVerify}
            onOverrideChange={setOverrideVerify}
          />
        ) : null}
        {error ? <p className="plan-editor__error">{error}</p> : null}
        <div className="plan-editor__bar">
          <button
            type="button"
            className="btn"
            onClick={approve}
            disabled={
              committing ||
              preview.destinationExists ||
              (preview.toState === 'done' &&
                !verifyResult?.ok &&
                !overrideVerify)
            }
          >
            {committing ? 'Committing…' : 'Approve & commit'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setPreview(null)
              resetVerify()
            }}
            disabled={committing}
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  if (question) {
    return (
      <div className="move">
        <h2 className="move__title">
          Move to{' '}
          {draftingTarget ? PLAN_STATE_LABELS[draftingTarget] : 'new state'}
        </h2>
        <p className="move__hint">Flue has a question before rewriting:</p>
        <p>{question}</p>
        <textarea
          className="move__context"
          placeholder="Your answer…"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        {error ? <p className="plan-editor__error">{error}</p> : null}
        <div className="plan-editor__bar">
          <button
            type="button"
            className="btn"
            onClick={sendAnswer}
            disabled={busy || answer.trim().length === 0}
          >
            {busy ? 'Thinking…' : 'Answer'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={cancelDraft}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="move">
      <h2 className="move__title">Move with AI</h2>
      <p className="move__hint">
        Flue (grounded in this repo's codebase) rewrites the plan for its new
        state — asking a clarifying question first if it needs one — then shows
        you a diff to approve before anything is committed.
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
            disabled={busy}
          >
            {busy && draftingTarget === s
              ? 'Drafting…'
              : `→ ${PLAN_STATE_LABELS[s]}`}
          </button>
        ))}
      </div>
      {error ? <p className="plan-editor__error">{error}</p> : null}
    </div>
  )
}

/**
 * Slice 5's "container escalation" for a move to `done`: clones the repo's
 * default branch into an ephemeral Sandbox (via a Workflow — clone + install
 * + test/build can take minutes) and runs its own test/build scripts, so the
 * author sees them actually pass before committing rather than trusting the
 * move preview's prose. Gates `PlanMoveControl`'s approve button; never
 * touches the plan or the commit path itself.
 */
function VerifyMoveControl({
  verifying,
  result,
  error,
  override,
  onRun,
  onOverrideChange,
}: {
  verifying: boolean
  result: VerifyPlanMoveResult | null
  error: string | null
  override: boolean
  onRun: () => void
  onOverrideChange: (value: boolean) => void
}) {
  const needsOverride = !result?.ok

  return (
    <div className="move__verify">
      <div className="move__verify-bar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onRun}
          disabled={verifying}
        >
          {verifying
            ? 'Running tests & build…'
            : result || error
              ? 'Run again'
              : 'Run tests & build before committing'}
        </button>
        {verifying ? (
          <span className="muted">
            Cloning the repo and running its scripts — this can take a few
            minutes.
          </span>
        ) : null}
      </div>
      {error ? <p className="plan-editor__error">{error}</p> : null}
      {result ? (
        result.ranScripts.length === 0 ? (
          <p className="move__warn">
            No <code>test</code> or <code>build</code> script found in this
            repo's package.json — nothing to verify.
          </p>
        ) : (
          <ul className="move__verify-steps">
            {result.steps.map((step) => (
              <li
                key={step.name}
                className={
                  step.success
                    ? 'move__verify-step move__verify-step--ok'
                    : 'move__verify-step move__verify-step--fail'
                }
              >
                <strong>
                  {step.success ? '✓' : '✗'} {step.command ?? step.name}
                </strong>
                {!step.success && step.logTail ? (
                  <pre className="move__verify-log">{step.logTail}</pre>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {needsOverride ? (
        <label className="move__verify-override">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => onOverrideChange(e.target.checked)}
          />
          Commit anyway
        </label>
      ) : null}
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
