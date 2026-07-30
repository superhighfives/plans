import { Agent, type Connection, type WSMessage } from 'agents'
import { getDb } from '~/db'
import type { Repo } from '~/db/schema'
import { getEnv } from '~/env'
import {
  type AiMessage,
  completeToolTurn,
  type ToolUseBlock,
} from '~/lib/ai/gateway'
import {
  ASK_USER_TOOL,
  buildConversationalBacklogPrompt,
  NEW_BACKLOG_TOOL,
} from '~/lib/ai/plan-prompts'
import { getInstallationToken } from '~/lib/github/app'
import { fetchRepoTree } from '~/lib/github/tree'
import { type CodebaseFile, fetchContextFiles } from '~/server/codebase.server'
import {
  buildBacklogPreview,
  findRepoContext,
  type RepoContext,
} from '~/server/plans.server'
import { parseInstanceName } from './instance'

/** Tools offered every turn of the conversational new-backlog draft. */
const DRAFT_TOOLS = [ASK_USER_TOOL, NEW_BACKLOG_TOOL]

/** An in-flight new-backlog draft conversation, keyed by connection id. */
interface DraftState {
  system: string
  repo: Repo
  token: string
  messages: AiMessage[]
}

/**
 * Flue — the per-repo conversational agent (Cloudflare Agents SDK).
 *
 * One Durable Object instance per repo, named `owner~repo`. Slice 2 gave it
 * codebase awareness (a `context` message reads the repo's curated
 * stack/config/docs files via the installation token, cached in its own
 * SQLite keyed by tree sha). Slice 3 adds the conversational new-backlog
 * draft: `draft_backlog` starts a Q&A loop — the model answers each turn via
 * either `ask_user` (paused, forwarded to the client, resumed by an `answer`
 * message) or `emit_backlog_item` (ends the loop) — grounded in that cached
 * codebase context. The finished draft is packaged the same way the one-shot
 * `proposeNewBacklog` path is, so the existing preview/commit UI and
 * `commitBacklogItem` need no changes.
 */
export class FlueAgent extends Agent {
  async onMessage(connection: Connection, message: WSMessage) {
    let parsed: { type?: string; idea?: string; answer?: string } = {}
    try {
      if (typeof message === 'string') parsed = JSON.parse(message)
    } catch {
      // non-JSON — falls through to echo
    }

    if (parsed.type === 'context') {
      await this.sendContext(connection)
      return
    }
    if (parsed.type === 'draft_backlog') {
      const idea = parsed.idea?.trim()
      if (!idea) return this.fail(connection, 'idea-required')
      await this.startDraft(connection, idea)
      return
    }
    if (parsed.type === 'answer') {
      const answer = parsed.answer?.trim()
      if (!answer) return this.fail(connection, 'answer-required')
      await this.continueDraft(connection, answer)
      return
    }
    connection.send(
      JSON.stringify({ type: 'echo', received: message, agent: this.name }),
    )
  }

  /** Drop any in-flight draft for a connection that's gone — nothing else references it. */
  onClose(connection: Connection) {
    this.deleteDraft(connection.id)
  }

  /** Load (cache-first) this repo's codebase context and send back the manifest. */
  private async sendContext(connection: Connection) {
    const ref = parseInstanceName(this.name)
    if (!ref) return this.fail(connection, 'bad-instance')

    // Everything below can throw (revoked installation, GitHub rate limit, a
    // blob 404ing between the tree read and the blob read). The base
    // Agent.onError only console.errors, so without this the client would hang
    // with no signal — route real failures through fail() too.
    try {
      const env = getEnv()
      const db = getDb()
      const ctx = await findRepoContext(db, ref.owner, ref.repo)
      if (!ctx) return this.fail(connection, 'repo-not-found')

      const token = await getInstallationToken(db, env, ctx.installation)
      const { tree, files, cached } = await this.loadContext(token, ctx)

      connection.send(
        JSON.stringify({
          type: 'context',
          treeSha: tree.treeSha,
          cached,
          // Surfaced so a very large (truncated) repo tree is a visible signal,
          // not a silently-incomplete context set.
          truncated: tree.truncated,
          files: files.map((f) => f.path),
        }),
      )
    } catch (err) {
      console.error('Flue context load failed', err)
      this.fail(connection, 'context-failed')
    }
  }

  /** Start a conversational new-backlog draft: first model turn from the idea + codebase context. */
  private async startDraft(connection: Connection, idea: string) {
    const ref = parseInstanceName(this.name)
    if (!ref) return this.fail(connection, 'bad-instance')

    try {
      const env = getEnv()
      const db = getDb()
      const ctx = await findRepoContext(db, ref.owner, ref.repo)
      if (!ctx) return this.fail(connection, 'repo-not-found')

      const token = await getInstallationToken(db, env, ctx.installation)
      const { files } = await this.loadContext(token, ctx)

      const { system, prompt } = buildConversationalBacklogPrompt({
        idea,
        context: files,
      })
      const messages: AiMessage[] = [{ role: 'user', content: prompt }]
      const result = await completeToolTurn(env, {
        system,
        messages,
        tools: DRAFT_TOOLS,
      })

      this.writeDraft(connection.id, {
        system,
        repo: ctx.repo,
        token,
        messages: [...messages, { role: 'assistant', content: result.content }],
      })
      await this.handleDraftTurn(connection, result)
    } catch (err) {
      console.error('Flue draft_backlog failed', err)
      this.fail(connection, 'draft-failed')
    }
  }

  /** Resume a paused draft with the author's answer to the pending `ask_user` question. */
  private async continueDraft(connection: Connection, answer: string) {
    const state = this.readDraft(connection.id)
    if (!state) return this.fail(connection, 'no-active-draft')

    const pending = lastToolUse(state.messages)
    if (!pending || pending.name !== 'ask_user')
      return this.fail(connection, 'no-pending-question')

    try {
      const env = getEnv()
      const messages: AiMessage[] = [
        ...state.messages,
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: pending.id, content: answer },
          ],
        },
      ]
      const result = await completeToolTurn(env, {
        system: state.system,
        messages,
        tools: DRAFT_TOOLS,
      })

      this.writeDraft(connection.id, {
        ...state,
        messages: [...messages, { role: 'assistant', content: result.content }],
      })
      await this.handleDraftTurn(connection, result)
    } catch (err) {
      console.error('Flue continue draft failed', err)
      this.fail(connection, 'draft-failed')
    }
  }

  /** Act on one model turn: forward a clarifying question, or package + send the finished draft. */
  private async handleDraftTurn(
    connection: Connection,
    result: { toolCall: { name: string; input: unknown } },
  ) {
    if (result.toolCall.name === 'ask_user') {
      const { question } = result.toolCall.input as { question: string }
      connection.send(JSON.stringify({ type: 'question', question }))
      return
    }

    const state = this.readDraft(connection.id)
    this.deleteDraft(connection.id)
    if (!state) return this.fail(connection, 'no-active-draft')

    const draft = result.toolCall.input as { title: string; body: string }
    const preview = await buildBacklogPreview(state.token, state.repo, draft)
    connection.send(JSON.stringify({ type: 'preview', ...preview }))
  }

  /** Load (cache-first) this repo's codebase context: tree + curated files. */
  private async loadContext(token: string, ctx: RepoContext) {
    const tree = await fetchRepoTree(
      token,
      ctx.repo.owner,
      ctx.repo.name,
      ctx.repo.defaultBranch,
    )
    let files = this.readCache(tree.treeSha)
    let cached = true
    if (!files) {
      cached = false
      const fetched = await fetchContextFiles(
        token,
        ctx.repo.owner,
        ctx.repo.name,
        tree.entries,
      )
      files = this.writeCache(tree.treeSha, fetched)
    }
    return { tree, files, cached }
  }

  private fail(connection: Connection, error: string) {
    connection.send(JSON.stringify({ type: 'error', error }))
  }

  /**
   * Draft conversation state, keyed by connection id, persisted in the DO's
   * SQLite storage rather than an instance field — this Durable Object
   * hibernates by default (see `agents`' `AgentStaticOptions.hibernate`),
   * which evicts plain in-memory fields between messages while the
   * WebSocket itself stays open. `ask_user` pauses exactly across that gap
   * waiting on the author to type an answer, so the state has to survive it.
   */
  private ensureDraftsTable() {
    this.sql`CREATE TABLE IF NOT EXISTS drafts (
      connection_id TEXT PRIMARY KEY,
      state TEXT NOT NULL
    )`
  }

  private readDraft(connectionId: string): DraftState | null {
    this.ensureDraftsTable()
    const rows = this.sql<{ state: string }>`
      SELECT state FROM drafts WHERE connection_id = ${connectionId}`
    return rows[0] ? (JSON.parse(rows[0].state) as DraftState) : null
  }

  private writeDraft(connectionId: string, state: DraftState) {
    this.ensureDraftsTable()
    this.sql`INSERT INTO drafts (connection_id, state)
      VALUES (${connectionId}, ${JSON.stringify(state)})
      ON CONFLICT (connection_id) DO UPDATE SET state = excluded.state`
  }

  private deleteDraft(connectionId: string) {
    this.ensureDraftsTable()
    this.sql`DELETE FROM drafts WHERE connection_id = ${connectionId}`
  }

  private ensureCacheTable() {
    this.sql`CREATE TABLE IF NOT EXISTS codebase_cache (
      tree_sha TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL
    )`
  }

  private readCache(treeSha: string): CodebaseFile[] | null {
    this.ensureCacheTable()
    const rows = this.sql<{ path: string; content: string }>`
      SELECT path, content FROM codebase_cache WHERE tree_sha = ${treeSha}`
    return rows.length
      ? rows.map((r) => ({ path: r.path, text: r.content }))
      : null
  }

  private writeCache(treeSha: string, files: CodebaseFile[]): CodebaseFile[] {
    this.ensureCacheTable()
    // Only the current tree's files are worth keeping — drop any older sha.
    this.sql`DELETE FROM codebase_cache WHERE tree_sha != ${treeSha}`
    for (const f of files) {
      this.sql`INSERT INTO codebase_cache (tree_sha, path, content)
        VALUES (${treeSha}, ${f.path}, ${f.text})`
    }
    return files
  }
}

/** The tool_use block in a message's content, if any — used to recover the
 * pending `ask_user` call's id when resuming a draft with the author's answer. */
function lastToolUse(
  messages: AiMessage[],
): { id: string; name: string } | null {
  const last = messages.at(-1)
  if (!last || typeof last.content === 'string') return null
  const block = last.content.find(
    (b): b is ToolUseBlock => b.type === 'tool_use',
  )
  return block ? { id: block.id, name: block.name } : null
}
