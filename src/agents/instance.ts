/** The repo an agent instance targets. Named distinctly from `plans/types`'
 * `RepoRef` (a richer shape) to avoid importing the wrong one. */
export interface InstanceRef {
  owner: string
  repo: string
}

/**
 * Split a Flue instance name (`owner~repo`) into its parts. `~` can't appear in
 * a GitHub owner or repo name, so it's an unambiguous, slash-free delimiter and
 * the first `~` is always the boundary (repo names may contain more `~`… they
 * can't, but splitting on the first is still correct). Returns null when the
 * delimiter or either side is missing. Pure — used both by the request gate and
 * inside the Durable Object (which knows itself only by this name).
 */
export function parseInstanceName(instance: string): InstanceRef | null {
  const sep = instance.indexOf('~')
  if (sep === -1) return null
  const owner = instance.slice(0, sep)
  const repo = instance.slice(sep + 1)
  if (!owner || !repo) return null
  return { owner, repo }
}

/**
 * Parse the repo an `/agents/*` request targets from its instance segment.
 * Side-effect-free so the gate's parsing is unit-testable on its own.
 *
 * Returns null for anything malformed — a missing segment, a bad
 * percent-encoding (a bare `%` makes `decodeURIComponent` throw), no `~`, or an
 * empty owner/repo — so the caller can answer 400 without risking an unhandled
 * `URIError` (which would surface as a pre-auth 500).
 */
export function parseAgentInstance(pathname: string): InstanceRef | null {
  // ['agents', '<agent>', '<instance>', ...]
  const segment = pathname.split('/').filter(Boolean)[2]
  if (!segment) return null

  let instance: string
  try {
    instance = decodeURIComponent(segment)
  } catch {
    return null
  }

  return parseInstanceName(instance)
}
