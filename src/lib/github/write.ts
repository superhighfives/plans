import { toBase64 } from '~/lib/crypto'
import { githubRequest } from './client'
import { encodePath } from './plans'

const utf8 = new TextEncoder()

interface ContentsPutResponse {
  content: { sha: string } | null
  commit: { sha: string }
}

export interface WriteFileResult {
  /** Git blob sha of the file after the write. */
  blobSha: string
  /** Sha of the commit that made the change. */
  commitSha: string
}

/**
 * Create or update a single file via the Contents API in one commit.
 *
 * When `sha` is supplied GitHub updates that blob and rejects the write with a
 * 409 if the sha is stale — this is our base-SHA conflict guard, so a concurrent
 * edit surfaces instead of clobbering. Omit `sha` to create a new file (GitHub
 * 422s if one already exists at the path). With an installation token the commit
 * is authored by the GitHub App bot, which is what we want for the audit trail.
 */
export async function putFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  params: { content: string; message: string; sha?: string; branch?: string },
): Promise<WriteFileResult> {
  const res = await githubRequest<ContentsPutResponse>(
    `/repos/${owner}/${repo}/contents/${encodePath(path)}`,
    {
      method: 'PUT',
      token,
      body: {
        message: params.message,
        content: toBase64(utf8.encode(params.content)),
        ...(params.sha ? { sha: params.sha } : {}),
        ...(params.branch ? { branch: params.branch } : {}),
      },
    },
  )
  return { blobSha: res.content?.sha ?? '', commitSha: res.commit.sha }
}

/** One file operation in a multi-path commit: write `content`, or delete when null. */
export interface TreeChange {
  path: string
  /** New UTF-8 file content, or null to delete the path. */
  content: string | null
}

interface RefResponse {
  object: { sha: string }
}
interface CommitResponse {
  sha: string
  tree: { sha: string }
}
interface TreeCreateResponse {
  sha: string
}

/**
 * Apply several file changes as a single commit via the Git Data API
 * (blob/tree/commit/ref). This is what makes a plan *move* atomic — the delete
 * of the old path and the write of the new path land in one commit.
 *
 * The ref update is non-forced, so a concurrent push to the branch since we read
 * its head fails the update rather than clobbering it. Callers should still guard
 * the specific file against the base blob sha before calling.
 */
export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  params: { message: string; changes: TreeChange[] },
): Promise<{ commitSha: string }> {
  const auth = { token }
  const ref = await githubRequest<RefResponse>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    auth,
  )
  const headCommitSha = ref.object.sha
  const headCommit = await githubRequest<CommitResponse>(
    `/repos/${owner}/${repo}/git/commits/${headCommitSha}`,
    auth,
  )

  const tree = await githubRequest<TreeCreateResponse>(
    `/repos/${owner}/${repo}/git/trees`,
    {
      ...auth,
      method: 'POST',
      body: {
        base_tree: headCommit.tree.sha,
        tree: params.changes.map((c) => ({
          path: c.path,
          mode: '100644',
          type: 'blob',
          // sha: null deletes the path; content creates/updates the blob.
          ...(c.content === null ? { sha: null } : { content: c.content }),
        })),
      },
    },
  )

  const commit = await githubRequest<CommitResponse>(
    `/repos/${owner}/${repo}/git/commits`,
    {
      ...auth,
      method: 'POST',
      body: {
        message: params.message,
        tree: tree.sha,
        parents: [headCommitSha],
      },
    },
  )

  await githubRequest(
    `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    { ...auth, method: 'PATCH', body: { sha: commit.sha, force: false } },
  )

  return { commitSha: commit.sha }
}
