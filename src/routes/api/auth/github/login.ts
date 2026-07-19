import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '~/env'
import { randomToken } from '~/lib/crypto'
import { buildAuthorizeUrl } from '~/lib/github/oauth'
import { buildOAuthStateSetCookie } from '~/server/session'

export const Route = createFileRoute('/api/auth/github/login')({
  server: {
    handlers: {
      GET: async () => {
        const env = getEnv()
        const state = randomToken(32)
        const location = buildAuthorizeUrl(env, state)
        return new Response(null, {
          status: 302,
          headers: {
            Location: location,
            'Set-Cookie': await buildOAuthStateSetCookie(env, state),
          },
        })
      },
    },
  },
})
