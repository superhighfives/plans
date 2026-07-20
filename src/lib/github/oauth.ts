import type { AppEnv } from '~/env'
import { githubPaginate, GitHubError } from './client'

export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string
}

export interface UserInstallation {
  id: number
  account: {
    login: string
    type: string // 'User' | 'Organization'
    avatar_url: string
  } | null
  suspended_at: string | null
}

/** Build the GitHub App user-authorization URL (user-to-server login). */
export function buildAuthorizeUrl(env: AppEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/api/auth/github/callback`,
    state,
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

/** Exchange an authorization code for a user access token. */
export async function exchangeCodeForToken(env: AppEnv, code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'plans',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_URL}/api/auth/github/callback`,
    }),
  })
  if (!res.ok) {
    throw new GitHubError('Failed to exchange OAuth code', res.status)
  }
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string }
  if (!json.access_token) {
    throw new GitHubError(json.error_description ?? json.error ?? 'No access token returned', 400)
  }
  return json.access_token
}

/** Identify the logged-in user from their access token. */
export async function fetchAuthedUser(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'plans',
    },
  })
  if (!res.ok) throw new GitHubError('Failed to fetch GitHub user', res.status)
  return (await res.json()) as GitHubUser
}

/** List the App installations this user can access (their own + orgs). */
export async function fetchUserInstallations(token: string): Promise<UserInstallation[]> {
  return githubPaginate<UserInstallation>('/user/installations', {
    token,
    arrayKey: 'installations',
  })
}
