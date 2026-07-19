import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { readSession } from './session'
import { getUserById } from './users.server'

export interface CurrentUser {
  id: string
  login: string
  name: string | null
  avatarUrl: string | null
}

/**
 * Return the logged-in user, or null. Safe to call from anywhere — it reads the
 * session cookie and never throws for anonymous visitors (the dashboard uses
 * this to render either the login CTA or the authed view).
 */
export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CurrentUser | null> => {
    const env = getEnv()
    const session = await readSession(env, getRequest().headers.get('cookie'))
    if (!session) return null

    const user = await getUserById(getDb(), session.uid)
    if (!user) return null

    return {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
    }
  },
)
