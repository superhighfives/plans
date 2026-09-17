/**
 * Heuristic scan for unresolved questions — used to warn (not block) before a
 * plan is promoted to `ready`. Matches the conventions the skill's prose uses.
 */
export function findOpenQuestions(body: string): string[] {
  const found: string[] = []
  const lines = body.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // A markdown heading like "## Open questions" names a *section*; it isn't
    // itself an unresolved question. Skip it so we don't flag the heading text.
    if (line.startsWith('#')) continue
    if (
      /\bopen question/i.test(line) ||
      /\b(TBD|TODO|FIXME)\b/.test(line) ||
      /\?{2,}/.test(line)
    ) {
      found.push(line.replace(/^[-*#>\s]+/, '').slice(0, 140))
    }
  }
  return found
}
