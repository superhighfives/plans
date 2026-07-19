import type { ReactNode } from 'react'
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { getCurrentUser, type CurrentUser } from '~/server/auth.functions'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Planning CMS' },
      {
        name: 'description',
        content: 'Browse the plans/ directories across your GitHub repos.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  loader: () => getCurrentUser(),
  component: RootComponent,
})

function RootComponent() {
  const user = Route.useLoaderData()
  return (
    <RootDocument>
      <Header user={user} />
      <main className="container">
        <Outlet />
      </main>
    </RootDocument>
  )
}

function Header({ user }: { user: CurrentUser | null }) {
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand">
          <span className="brand__mark" aria-hidden>◇</span>
          <span>Planning CMS</span>
        </Link>
        <div className="site-header__right">
          {user ? (
            <>
              {user.avatarUrl ? (
                <img className="avatar" src={user.avatarUrl} alt="" width={28} height={28} />
              ) : null}
              <span className="site-header__login">{user.login}</span>
              <form method="post" action="/api/auth/logout">
                <button type="submit" className="btn btn--ghost">Sign out</button>
              </form>
            </>
          ) : (
            <a className="btn" href="/api/auth/github/login">Sign in with GitHub</a>
          )}
        </div>
      </div>
    </header>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
