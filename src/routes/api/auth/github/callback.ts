import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { timingSafeEqual } from '~/lib/crypto'
import {
  exchangeCodeForToken,
  fetchAuthedUser,
  fetchUserInstallations,
} from '~/lib/github/oauth'
import {
  buildOAuthStateClearCookie,
  buildSessionSetCookie,
  readOAuthState,
} from '~/server/session'
import { upsertUserAndInstallations } from '~/server/users.server'

export const Route = createFileRoute('/api/auth/github/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const env = getEnv()
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        // Verify the state cookie matches the returned state (CSRF defense).
        const expectedState = await readOAuthState(env, request.headers.get('cookie'))
        if (!code || !state || !expectedState || !timingSafeEqual(state, expectedState)) {
          return redirectHome('/?error=oauth_state', env, /* clearState */ true)
        }

        try {
          const userToken = await exchangeCodeForToken(env, code)
          const [ghUser, ghInstallations] = await Promise.all([
            fetchAuthedUser(userToken),
            fetchUserInstallations(userToken),
          ])

          const db = getDb()
          const user = await upsertUserAndInstallations(db, ghUser, ghInstallations)

          const headers = new Headers({ Location: '/' })
          headers.append(
            'Set-Cookie',
            await buildSessionSetCookie(env, {
              uid: user.id,
              login: user.login,
              iat: Math.floor(Date.now() / 1000),
            }),
          )
          headers.append('Set-Cookie', buildOAuthStateClearCookie(env))
          return new Response(null, { status: 302, headers })
        } catch {
          return redirectHome('/?error=oauth_failed', env, true)
        }
      },
    },
  },
})

function redirectHome(location: string, env: ReturnType<typeof getEnv>, clearState: boolean): Response {
  const headers = new Headers({ Location: location })
  if (clearState) headers.append('Set-Cookie', buildOAuthStateClearCookie(env))
  return new Response(null, { status: 302, headers })
}
