import { createFileRoute } from '@tanstack/react-router'
import { renderStartPage, renderStartScript } from '~/lib/plans/bootstrap'

export const Route = createFileRoute('/start/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin
        // Browsers (and agents that ask for a page) get the readable runbook;
        // `curl` (Accept: */*) gets the pipeable shell script.
        const accept = request.headers.get('accept') ?? ''
        if (accept.includes('text/html')) {
          return new Response(renderStartPage(origin), {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
            },
          })
        }
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
