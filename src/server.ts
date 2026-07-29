import type { ExecutionContext } from '@cloudflare/workers-types'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { routeAgentRequest } from 'agents'

// The Durable Object class must be a named export of the Worker entry so the
// runtime can bind it. Re-exported here (this file is the configured
// `server.entry`) rather than from a route module.
export { FlueAgent } from './agents/flue-agent'

const handleStart = createStartHandler(defaultStreamHandler)

/**
 * Custom Worker entry. `/agents/*` (WebSocket + RPC) is handed to the Agents
 * SDK router; everything else falls through to the TanStack Start handler.
 * Start reads its env via `cloudflare:workers`, so it only needs the request;
 * `routeAgentRequest` needs the raw Worker `env` (for the DO binding).
 */
export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/agents/')) {
      const res = await routeAgentRequest(request, env)
      if (res) return res
    }
    return handleStart(request)
  },
}
