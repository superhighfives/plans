import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { getCurrentUser } from '~/server/auth.functions'
import {
  type Dashboard,
  getDashboard,
  refreshDashboard,
} from '~/server/dashboard.functions'

export const Route = createFileRoute('/')({
  loader: async (): Promise<{
    authed: boolean
    dashboard: Dashboard | null
  }> => {
    const user = await getCurrentUser()
    if (!user) return { authed: false, dashboard: null }
    return { authed: true, dashboard: await getDashboard() }
  },
  component: DashboardPage,
})

function DashboardPage() {
  const { authed, dashboard } = Route.useLoaderData()
  if (!authed || !dashboard) return <Landing />
  return <DashboardView dashboard={dashboard} />
}

function Landing() {
  return (
    <section className="hero">
      <h1>Your plans, everywhere.</h1>
      <p className="hero__lead">
        Plans reads the <code>plans/</code> directories across your GitHub repos
        and lets you browse them by state — backlog, ready, in progress, and
        done — all in one place.
      </p>
      <a className="btn btn--lg" href="/api/auth/github/login">
        Sign in with GitHub
      </a>
      <p className="hero__hint">
        You’ll install the GitHub App on the repos you want to browse. It
        requests read access to repository contents and nothing more.
      </p>
    </section>
  )
}

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const router = useRouter()
  const refresh = useServerFn(refreshDashboard)
  const [busy, setBusy] = useState(false)

  async function onRefresh() {
    setBusy(true)
    try {
      await refresh()
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {dashboard.reposWithPlans} repo
            {dashboard.reposWithPlans === 1 ? '' : 's'} with plans
            {dashboard.lastScannedAt
              ? ` · scanned ${formatWhen(dashboard.lastScannedAt)}`
              : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? 'Scanning…' : 'Rescan repos'}
        </button>
      </div>

      {dashboard.installations.length === 0 ? (
        <div className="empty">
          <h2>No installations yet</h2>
          <p>
            Install the Plans GitHub App on your account or an org, then rescan.
            Only repos with a top-level <code>plans/</code> folder show up.
          </p>
        </div>
      ) : (
        dashboard.installations.map((inst) => (
          <div className="installation" key={inst.id}>
            <div className="installation__head">
              {inst.accountAvatarUrl ? (
                <img
                  className="avatar"
                  src={inst.accountAvatarUrl}
                  alt=""
                  width={24}
                  height={24}
                />
              ) : null}
              <h2>{inst.accountLogin}</h2>
              <span className="tag">{inst.accountType}</span>
              {inst.suspended ? (
                <span className="tag tag--warn">Suspended</span>
              ) : null}
            </div>
            {inst.repos.length === 0 ? (
              <p className="muted installation__empty">
                No repos with a <code>plans/</code> folder here.
              </p>
            ) : (
              <ul className="repo-list">
                {inst.repos.map((repo) => (
                  <li key={repo.fullName}>
                    <Link
                      to="/repos/$owner/$repo"
                      params={{ owner: repo.owner, repo: repo.name }}
                      className="repo-list__item"
                    >
                      <span className="repo-list__name">{repo.fullName}</span>
                      {repo.isPrivate ? (
                        <span className="tag">Private</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </section>
  )
}

function formatWhen(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
