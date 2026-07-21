import { fromBase64 } from '~/lib/crypto'
import { isPlanPath } from '~/lib/plans/states'
import { githubPaginate, githubRequest } from './client'

interface TreeResponse {
  sha: string
  tree: Array<{ path: string; type: string; sha: string }>
  truncated: boolean
}

export interface PlanTreeEntry {
  path: string
  sha: string
}

export interface PlanTree {
  /** Tree sha — used as the cache key / invalidation marker. */
  treeSha: string
  entries: PlanTreeEntry[]
  /** True if GitHub truncated the tree (very large repo). Plans are shallow, so rare. */
  truncated: boolean
}

/**
 * List the plan files (plans/<state>/*.md) on a branch using the Git Trees API
 * recursively. One request per repo — cheap enough to run during discovery.
 */
export async function listPlanTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<PlanTree> {
  const res = await githubRequest<TreeResponse>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { token },
  )
  const entries = res.tree
    .filter((e) => e.type === 'blob' && isPlanPath(e.path))
    .map((e) => ({ path: e.path, sha: e.sha }))
  return { treeSha: res.sha, entries, truncated: res.truncated }
}

interface PullResponse {
  number: number
  title: string
  draft?: boolean
  html_url: string
  updated_at: string
  user: { login: string } | null
  head: { ref: string; sha: string }
  base: { ref: string }
}

/** An open pull request, trimmed to what the board needs. */
export interface OpenPullRequest {
  number: number
  title: string
  authorLogin: string | null
  /** Branch name the PR is merging from. */
  headRef: string
  /** Head commit sha — the ref we read the branch's plan tree at. */
  headSha: string
  /** Branch the PR targets (usually the default branch). */
  baseRef: string
  draft: boolean
  /** github.com PR URL. */
  url: string
  /** ISO timestamp of the PR's last update. */
  updatedAt: string
}

/**
 * List a repo's open pull requests. Requires the App's `pull_requests: read`
 * permission — without it GitHub returns 403 (surfaced as a GitHubError), which
 * callers catch to degrade gracefully.
 */
export async function listOpenPullRequests(
  token: string,
  owner: string,
  repo: string,
): Promise<OpenPullRequest[]> {
  const pulls = await githubPaginate<PullResponse>(
    `/repos/${owner}/${repo}/pulls?state=open`,
    { token },
  )
  return pulls.map((p) => ({
    number: p.number,
    title: p.title,
    authorLogin: p.user?.login ?? null,
    headRef: p.head.ref,
    headSha: p.head.sha,
    baseRef: p.base.ref,
    draft: Boolean(p.draft),
    url: p.html_url,
    updatedAt: p.updated_at,
  }))
}

interface ContentFileResponse {
  type: string
  content?: string
  encoding?: string
  sha: string
}

/**
 * Fetch a single file via the Contents API on a given ref. Used when a plan is
 * opened directly (no prior tree scan), so we get the latest content + sha.
 */
export async function fetchContentFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ sha: string; text: string } | null> {
  const res = await githubRequest<ContentFileResponse>(
    `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    { token },
  )
  if (res.type !== 'file' || res.content == null) return null
  const text =
    res.encoding === 'base64'
      ? new TextDecoder().decode(fromBase64(res.content.replace(/\s+/g, '')))
      : (res.content ?? '')
  return { sha: res.sha, text }
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

interface BlobResponse {
  content: string
  encoding: string
}

/** Fetch and decode a blob's UTF-8 text content by sha. */
export async function fetchBlobText(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<string> {
  const res = await githubRequest<BlobResponse>(
    `/repos/${owner}/${repo}/git/blobs/${sha}`,
    { token },
  )
  if (res.encoding === 'base64') {
    const clean = res.content.replace(/\s+/g, '')
    return new TextDecoder().decode(fromBase64(clean))
  }
  return res.content
}
