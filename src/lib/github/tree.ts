import { githubRequest } from './client'

interface RawTreeResponse {
  sha: string
  tree: Array<{ path: string; type: string; sha: string; size?: number }>
  truncated: boolean
}

export interface RepoTreeEntry {
  path: string
  /** Git blob sha — the cache key for an individual file. */
  sha: string
  /** Blob size in bytes (absent for some entries). */
  size?: number
}

export interface RepoTree {
  /** Tree sha at `ref` — the invalidation key for the whole context cache. */
  treeSha: string
  entries: RepoTreeEntry[]
  /** True if GitHub truncated the tree (very large repo). */
  truncated: boolean
}

/**
 * The full blob tree of a repo at a ref (branch or commit sha), recursively.
 * Unlike `listPlanTree` this keeps every file, so the Flue agent can reason
 * about the whole codebase — pair it with `selectContextPaths` to pick the
 * files worth reading, and `fetchBlobText` to read them.
 */
export async function fetchRepoTree(
  token: string,
  owner: string,
  repo: string,
  ref: string,
): Promise<RepoTree> {
  const res = await githubRequest<RawTreeResponse>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { token },
  )
  const entries = res.tree
    .filter((e) => e.type === 'blob')
    .map((e) => ({ path: e.path, sha: e.sha, size: e.size }))
  return { treeSha: res.sha, entries, truncated: res.truncated }
}
