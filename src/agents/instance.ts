/**
 * Parse the repo an `/agents/*` request targets from its instance segment.
 *
 * The client names the Flue instance `owner~repo` (`~` can't appear in a GitHub
 * owner or repo name, so it's an unambiguous, slash-free delimiter). Pure and
 * side-effect-free so the gate's parsing is unit-testable on its own.
 *
 * Returns null for anything malformed — a missing segment, a bad
 * percent-encoding (a bare `%` makes `decodeURIComponent` throw), no `~`, or an
 * empty owner/repo — so the caller can answer 400 without risking an unhandled
 * `URIError` (which would surface as a pre-auth 500).
 */
export function parseAgentInstance(
  pathname: string,
): { owner: string; repo: string } | null {
  // ['agents', '<agent>', '<instance>', ...]
  const segment = pathname.split('/').filter(Boolean)[2]
  if (!segment) return null

  let instance: string
  try {
    instance = decodeURIComponent(segment)
  } catch {
    return null
  }

  const sep = instance.indexOf('~')
  if (sep === -1) return null
  const owner = instance.slice(0, sep)
  const repo = instance.slice(sep + 1)
  if (!owner || !repo) return null
  return { owner, repo }
}
