const GITHUB_API = 'https://api.github.com'
const USER_AGENT = 'plans'

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export interface GitHubRequestOptions {
  method?: string
  /** Bearer token: an App JWT or an installation/user access token. */
  token: string
  body?: unknown
  /** Override the Accept header (defaults to the v3 JSON media type). */
  accept?: string
}

/** Low-level authenticated request to the GitHub REST API. Throws on non-2xx. */
export async function githubRequest<T = unknown>(
  path: string,
  opts: GitHubRequestOptions,
): Promise<T> {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: opts.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = await res.text().catch(() => undefined)
    }
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : undefined) ?? `GitHub request failed: ${res.status}`
    throw new GitHubError(message, res.status, body)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Follow `Link: rel="next"` pagination, accumulating an array field from each
 * page (or the array response itself for endpoints that return a bare array).
 */
export async function githubPaginate<T>(
  path: string,
  opts: GitHubRequestOptions & { arrayKey?: string; perPage?: number },
): Promise<T[]> {
  const results: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  let next: string | null = `${path}${sep}per_page=${opts.perPage ?? 100}`

  while (next) {
    const url: string = next.startsWith('http') ? next : `${GITHUB_API}${next}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: opts.accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
      },
    })
    if (!res.ok) {
      throw new GitHubError(
        `GitHub pagination failed: ${res.status}`,
        res.status,
      )
    }
    const json = (await res.json()) as unknown
    const page = opts.arrayKey
      ? ((json as Record<string, unknown>)[opts.arrayKey] as T[])
      : (json as T[])
    if (Array.isArray(page)) results.push(...page)
    next = parseNextLink(res.headers.get('link'))
  }
  return results
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part.trim())
    if (m) return m[1] ?? null
  }
  return null
}
