import { fromBase64 } from '~/lib/crypto'
import { isPlanPath } from '~/lib/plans/states'
import { githubRequest } from './client'

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
