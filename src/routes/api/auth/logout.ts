import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '~/env'
import { buildSessionClearCookie } from '~/server/session'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async () => {
        const env = getEnv()
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': buildSessionClearCookie(env),
          },
        })
      },
    },
  },
})
