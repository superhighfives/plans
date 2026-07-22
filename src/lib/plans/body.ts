/**
 * Plan bodies (frontmatter already stripped) conventionally open with an H1 that
 * repeats the plan title, followed by a small metadata block. Some of that block
 * duplicates the frontmatter (`**Date**:` ≈ `created`, `**Status**:` ≈ `status`),
 * but other lines carry unique information (`**Scope**:`, a divergent `**Updated**:`,
 * `**PR**:`, …). The detail view already renders title + state/status/dates in a
 * header panel, so the H1 and the *redundant* lines are pure duplication.
 *
 * This trims the duplicate H1 and only the redundant `Date`/`Status` lines for
 * display, preserving every other metadata line. The stored/diffed body keeps the
 * original content.
 */

/** Any leading `Key:` / `**Key:**` metadata line (used to bound the metadata block). */
const META_LINE_RE = /^\s*\*{0,2}[A-Za-z][\w ]*\*{0,2}\s*:/
/** The metadata keys that merely echo frontmatter and are safe to drop. */
const REDUNDANT_META_RE = /^\s*\*{0,2}(date|status)\*{0,2}\s*:/i

/** Match an ATX H1 (`# Heading`, with optional trailing `#`s), capturing the text. */
const H1_RE = /^#\s+(.*?)\s*#*\s*$/

/** Normalize a heading/title for comparison: drop inline markdown (`, *, _) and case. */
function normalizeHeading(s: string): string {
  return s.replace(/[`*_]/g, '').trim().toLowerCase()
}

/**
 * Remove a leading H1 that matches `title` (trimmed, case-insensitive), then — only
 * when such a heading was removed — drop the redundant `**Date**`/`**Status**` lines
 * from the metadata block that follows, keeping any other metadata lines (Scope,
 * Updated, PR, …) intact. Returns the body unchanged when the first heading isn't a
 * title duplicate.
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

  // Walk the contiguous metadata block, keeping non-redundant lines.
  const kept: string[] = []
  while (i < lines.length && META_LINE_RE.test(lines[i] ?? '')) {
    const line = lines[i] ?? ''
    if (!REDUNDANT_META_RE.test(line)) kept.push(line)
    i++
  }

  const rest = lines.slice(i).join('\n').replace(/^\n+/, '')
  return kept.length > 0 ? `${kept.join('\n')}\n\n${rest}` : rest
}
