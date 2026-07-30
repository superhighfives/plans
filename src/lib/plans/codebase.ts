/**
 * Pick the files worth reading to understand a repo's stack, conventions, and
 * shape — the "curated context" the Flue agent reads before drafting a plan.
 * Pure and dependency-free (no I/O): it works on the path list from a repo tree,
 * so it's cheap and testable. The agent fetches the returned files' contents.
 */

/** Directories that never carry useful project context (vendored / generated). */
const IGNORED_DIR =
  /(^|\/)(node_modules|dist|build|out|\.next|\.turbo|\.output|\.vercel|vendor|coverage|\.git|\.cache)\//

/**
 * Basenames (case-insensitive) that describe a project's stack, docs, or config:
 * READMEs + agent docs, package manifests + lockfiles, and the common
 * per-ecosystem config/manifest files. Intentionally conservative — this is
 * "what stack is this and how is it built", not "read the whole repo".
 */
const CONTEXT_BASENAME =
  /^(readme(\.\w+)?|agents\.md|claude\.md|contributing\.md|package\.json|(pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?)|tsconfig(\.\w+)?\.json|jsconfig\.json|biome\.jsonc?|vite\.config\.[jt]s|next\.config\.[cm]?[jt]s|nuxt\.config\.[jt]s|svelte\.config\.js|astro\.config\.[mc]?js|tailwind\.config\.[jt]s|wrangler\.(jsonc?|toml)|cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|gemfile|composer\.json|dockerfile|docker-compose\.ya?ml|makefile|\.nvmrc|\.node-version|\.ruby-version)$/i

/** CI workflows carry the real build/test/deploy commands. */
const CI_WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/i

function depth(path: string): number {
  let n = 0
  for (const ch of path) if (ch === '/') n++
  return n
}

function isContextPath(path: string): boolean {
  if (IGNORED_DIR.test(`/${path}`)) return false
  if (CI_WORKFLOW.test(path)) return true
  const base = path.slice(path.lastIndexOf('/') + 1)
  return CONTEXT_BASENAME.test(base)
}

/**
 * From a repo's file paths, return the curated context files — shallowest first
 * (root README/manifests before nested ones), then alphabetical — capped at
 * `limit` (default 25) so the agent's prompt stays bounded.
 */
export function selectContextPaths(
  paths: string[],
  opts: { limit?: number } = {},
): string[] {
  const limit = opts.limit ?? 25
  return paths
    .filter(isContextPath)
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .slice(0, limit)
}
