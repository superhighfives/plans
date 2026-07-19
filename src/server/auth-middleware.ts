import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { readSession } from './session'
import { getUserById } from './users.server'

/**
 * Enforces a valid session and loads the app user. Attach to every server
 * function that touches private data — route guards are UX only, not the data
 * boundary (the RPC endpoint is reachable directly).
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest()
    const env = getEnv()
    const session = await readSession(env, request.headers.get('cookie'))
    if (!session) throw new Error('UNAUTHENTICATED')

    const db = getDb()
    const user = await getUserById(db, session.uid)
    if (!user) throw new Error('UNAUTHENTICATED')

    return next({ context: { user } })
  },
)
