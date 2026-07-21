import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  })
}

function NotFound() {
  return (
    <div className="empty">
      <h2>Not found</h2>
      <p>
        That page, repo, or plan doesn’t exist — or you don’t have access to it.
      </p>
      <a href="/">Back to dashboard</a>
    </div>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
