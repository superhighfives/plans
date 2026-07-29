import type { ExecutionContext } from '@cloudflare/workers-types'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { routeAgentRequest } from 'agents'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { resolveAccessibleRepo } from '~/server/plans.server'
import { readSession } from '~/server/session'
import { getUserById } from '~/server/users.server'

// The Durable Object class must be a named export of the Worker entry so the
// runtime can bind it. Re-exported here (this file is the Worker `main`) rather
// than from a route module.
export { FlueAgent } from './agents/flue-agent'

const handleStart = createStartHandler(defaultStreamHandler)

/**
 * Gate an `/agents/*` request before it reaches the Durable Object. The client
 * names the instance `owner~repo` (`~` can't appear in a GitHub owner or repo
 * name, so it's an unambiguous, slash-free delimiter), but the *client picking
 * the name is not the boundary* — we re-check that the session's user actually
 * has access to that repo (same check as every RPC). Returns an error Response
 * to short-circuit, or null to allow the request through.
 */
async function authorizeAgent(request: Request): Promise<Response | null> {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  // ['agents', '<agent>', '<instance>', ...]
  const instance = decodeURIComponent(segments[2] ?? '')
  const sep = instance.indexOf('~')
  const owner = sep === -1 ? '' : instance.slice(0, sep)
  const repo = sep === -1 ? '' : instance.slice(sep + 1)
  if (!owner || !repo)
    return new Response('Bad agent instance', { status: 400 })

  const env = getEnv()
  const session = await readSession(env, request.headers.get('cookie'))
  if (!session) return new Response('Unauthorized', { status: 401 })

  const db = getDb()
  const user = await getUserById(db, session.uid)
  if (!user) return new Response('Unauthorized', { status: 401 })

  const ctx = await resolveAccessibleRepo(db, user.id, owner, repo)
  if (!ctx) return new Response('Forbidden', { status: 403 })
  return null
}

/**
 * Custom Worker entry. `/agents/*` (WebSocket + RPC) is auth-gated and handed to
 * the Agents SDK router; everything else falls through to the TanStack Start
 * handler. Start reads its env via `cloudflare:workers`, so it only needs the
 * request; `routeAgentRequest` needs the raw Worker `env` (for the DO binding).
 */
export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/agents/')) {
      const denied = await authorizeAgent(request)
      if (denied) return denied
      const res = await routeAgentRequest(request, env)
      if (res) return res
    }
    return handleStart(request)
  },
}
