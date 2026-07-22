/**
 * Plan bodies (frontmatter already stripped) conventionally open with an H1 that
 * repeats the plan title, sometimes followed by a `**Date**: … **Status**: …`
 * metadata line. The detail view already renders title + state/status/dates in a
 * header panel, so that opening is pure duplication. This trims it for display
 * only — the stored/diffed body keeps the original content.
 */

/** A leading key:value metadata line (optionally bold keys) we treat as redundant. */
const META_LINE_RE =
  /^\s*\*{0,2}(date|status|created|updated|scope|owner|type)\*{0,2}\s*:/i

/** Match an ATX H1 (`# Heading`, with optional trailing `#`s), capturing the text. */
const H1_RE = /^#\s+(.*?)\s*#*\s*$/

/** Normalize a heading/title for comparison: drop inline markdown (`, *, _) and case. */
function normalizeHeading(s: string): string {
  return s.replace(/[`*_]/g, '').trim().toLowerCase()
}

/**
 * Remove a leading H1 that matches `title` (trimmed, case-insensitive), and — only
 * when such a heading was removed — any immediately-following metadata lines (e.g.
 * a `**Date**:` line and a `**Status**:` line, which some plans emit separately).
 * Returns the body unchanged when the first heading isn't a title duplicate.
 */
export function stripRedundantHeading(body: string, title: string): string {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++

  const heading = (lines[i] ?? '').match(H1_RE)
  if (!heading) return body
  if (normalizeHeading(heading[1] ?? '') !== normalizeHeading(title))
    return body

  i++ // drop the heading line
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  while (i < lines.length && META_LINE_RE.test(lines[i] ?? '')) i++ // drop meta lines

  return lines.slice(i).join('\n').replace(/^\n+/, '')
}
