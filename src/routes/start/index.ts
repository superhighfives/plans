import { createFileRoute } from '@tanstack/react-router'
import { renderStartScript } from '~/lib/plans/bootstrap'

export const Route = createFileRoute('/start/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin
        return new Response(renderStartScript(origin), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        })
      },
    },
  },
})
