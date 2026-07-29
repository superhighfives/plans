import { fetchBlobText } from '~/lib/github/plans'
import type { RepoTreeEntry } from '~/lib/github/tree'
import { selectContextPaths } from '~/lib/plans/codebase'

export interface CodebaseFile {
  path: string
  text: string
}

/** Cap on total context bytes pulled into memory (and later a prompt). */
const MAX_TOTAL_BYTES = 200_000
/** Skip individual files larger than this — lockfiles/minified config can be huge. */
const MAX_FILE_BYTES = 50_000

/**
 * Read the curated context files for a repo tree: pick the stack/config/docs
 * files (`selectContextPaths`), fetch each blob, and return them under a
 * total-size budget so the agent's context stays bounded. The caller owns
 * tree-sha caching (the Flue DO keeps these in its SQLite keyed by tree sha).
 */
export async function fetchContextFiles(
  token: string,
  owner: string,
  repo: string,
  entries: RepoTreeEntry[],
): Promise<CodebaseFile[]> {
  const shaByPath = new Map(entries.map((e) => [e.path, e.sha]))
  const files: CodebaseFile[] = []
  let budget = MAX_TOTAL_BYTES
  for (const path of selectContextPaths(entries.map((e) => e.path))) {
    const sha = shaByPath.get(path)
    if (!sha) continue
    const text = await fetchBlobText(token, owner, repo, sha)
    if (text.length > MAX_FILE_BYTES) continue
    if (text.length > budget) break
    files.push({ path, text })
    budget -= text.length
  }
  return files
}
