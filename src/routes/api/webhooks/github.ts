import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '~/db'
import { getEnv } from '~/env'
import { hmacHex, timingSafeEqual } from '~/lib/crypto'
import { handleInstallation, handlePush } from '~/server/webhooks.server'

export const Route = createFileRoute('/api/webhooks/github')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = getEnv()
        const raw = await request.text()

        // Verify the delivery signature before trusting anything in the body.
        const signature = request.headers.get('x-hub-signature-256')
        const expected = `sha256=${await hmacHex(env.GITHUB_WEBHOOK_SECRET, raw)}`
        if (!signature || !timingSafeEqual(signature, expected)) {
          return new Response('Invalid signature', { status: 401 })
        }

        const event = request.headers.get('x-github-event')
        let payload: unknown
        try {
          payload = JSON.parse(raw)
        } catch {
          return new Response('Invalid payload', { status: 400 })
        }

        const db = getDb()
        switch (event) {
          case 'push':
            await handlePush(db, env, payload)
            break
          case 'installation':
            await handleInstallation(db, payload)
            break
          // `installation_repositories` and others: no-op in v1; the next
          // dashboard rescan reconciles repo membership.
          default:
            break
        }

        return new Response('ok', { status: 200 })
      },
    },
  },
})
