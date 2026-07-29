import { Agent, type Connection, type WSMessage } from 'agents'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { getInstallationToken } from '~/lib/github/app'
import { fetchRepoTree } from '~/lib/github/tree'
import { type CodebaseFile, fetchContextFiles } from '~/server/codebase.server'
import { findRepoContext } from '~/server/plans.server'
import { parseInstanceName } from './instance'

/**
 * Flue — the per-repo conversational agent (Cloudflare Agents SDK).
 *
 * One Durable Object instance per repo, named `owner~repo`. Slice 2 gives it
 * codebase awareness: on a `context` message it reads the repo's curated
 * stack/config/docs files (via the installation token) and caches them in its
 * own SQLite keyed by the tree sha, so an unchanged repo skips the blob fetches.
 * The Q&A loop and the `propose_*` → commit tools come in later slices; a plain
 * message still echoes (the slice-1 transport check).
 */
export class FlueAgent extends Agent {
  async onMessage(connection: Connection, message: WSMessage) {
    let parsed: { type?: string } = {}
    try {
      if (typeof message === 'string') parsed = JSON.parse(message)
    } catch {
      // non-JSON — falls through to echo
    }

    if (parsed.type === 'context') {
      await this.sendContext(connection)
      return
    }
    connection.send(
      JSON.stringify({ type: 'echo', received: message, agent: this.name }),
    )
  }

  /** Load (cache-first) this repo's codebase context and send back the manifest. */
  private async sendContext(connection: Connection) {
    const ref = parseInstanceName(this.name)
    if (!ref) return this.fail(connection, 'bad-instance')

    const env = getEnv()
    const db = getDb()
    const ctx = await findRepoContext(db, ref.owner, ref.repo)
    if (!ctx) return this.fail(connection, 'repo-not-found')

    const token = await getInstallationToken(db, env, ctx.installation)
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

    connection.send(
      JSON.stringify({
        type: 'context',
        treeSha: tree.treeSha,
        cached,
        files: files.map((f) => f.path),
      }),
    )
  }

  private fail(connection: Connection, error: string) {
    connection.send(JSON.stringify({ type: 'error', error }))
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
