/**
 * Derive a kebab-case filename slug from a plan title, matching the skill's
 * naming convention (`add-oauth-login.md`). Pure and dependency-free so it runs
 * on the Workers runtime and is trivially testable.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    // Strip combining diacritics (U+0300–U+036F) so "café" → "cafe".
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    // Cap the length, then trim any hyphen the cut (or the input) left dangling.
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'untitled'
}

/**
 * Return `base`, or the first `base-N` (N≥2) not already in `taken`. Slugs are
 * only unique within a state directory, so callers pass the slugs already in the
 * destination state to avoid colliding with an existing plan's filename.
 */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}
