import { Agent, type Connection, type WSMessage } from 'agents'

/**
 * Flue — the per-repo conversational agent (Cloudflare Agents SDK).
 *
 * One Durable Object instance per repo (named `owner/repo`); its SQLite holds
 * the transcript + codebase-context cache in later slices. Slice 1 is the
 * scaffold: it just echoes messages back over the WebSocket to prove the
 * transport + routing + auth gate end to end. The codebase-context tools, the
 * `ask_user` Q&A loop, and the `propose_*` → commit path land in later slices.
 */
export class FlueAgent extends Agent {
  async onMessage(connection: Connection, message: WSMessage) {
    connection.send(
      JSON.stringify({ type: 'echo', received: message, agent: this.name }),
    )
  }
}
