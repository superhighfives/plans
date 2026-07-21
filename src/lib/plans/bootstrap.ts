/**
 * Content and script templates for the `/start` bootstrap endpoint.
 *
 * Kept here (pure, no I/O) so the routes stay thin and everything is unit
 * testable. `renderStartScript` produces the POSIX `sh` script served at
 * `/start`; the skill itself is served separately at `/start/skill`.
 */

/** HTML-comment delimiters so the AGENTS.md block can be found and replaced. */
export const AGENTS_BLOCK_START = '<!-- plans:start -->'
export const AGENTS_BLOCK_END = '<!-- plans:end -->'

/** The block appended to (or created as) a repo's AGENTS.md. */
export const AGENTS_BLOCK = `${AGENTS_BLOCK_START}
## Plans workflow

This repo manages implementation specs with the **plans** workflow: specs live
in \`plans/{backlog,ready,in-progress,done}/\`. Use the \`plans\` skill — run
\`/plans\`, or read \`.claude/skills/plans/SKILL.md\` — to create, start, and
finish plans. \`plans/README.md\` is the source of truth once bootstrapped.
${AGENTS_BLOCK_END}`

/** Seed content for a freshly bootstrapped repo's `plans/README.md`. */
export const PLANS_README_TEMPLATE = `# Plans

Implementation plans for this repo as markdown files, one per unit of work,
managed with the [\`plans\`](../.claude/skills/plans/SKILL.md) workflow. Plans
move through four states, one per subdirectory:

- **backlog/** — rough ideas, unscoped. Not ready to work on.
- **ready/** — fully specced; anyone (human or agent) could pick it up.
- **in-progress/** — actively being implemented.
- **done/** — shipped, with a record of what was actually built.

Normal flow is one-directional: backlog → ready → in-progress → done.

## Naming

kebab-case filenames that describe the work (\`add-oauth-login.md\`). Names stay
stable across the lifecycle; only the directory changes.

## Frontmatter

Every plan starts with YAML frontmatter:

    ---
    title: Add OAuth login
    status: Ready         # Backlog | Ready | In Progress | Complete
    created: 2026-01-01
    updated: 2026-01-01
    ---

Run \`/plans\` (or read \`.claude/skills/plans/SKILL.md\`) to create, start, and
finish plans. This README is the source of truth for this repo and wins over
the skill if they differ.
`

/**
 * Render the POSIX `sh` bootstrap script for a given app origin (no trailing
 * slash). Safe to re-run: every step is guarded and never clobbers existing
 * files. `origin` is interpolated as a shell single-quoted string, so it must
 * not contain a single quote (an app origin never does).
 */
export function renderStartScript(origin: string): string {
  return `#!/bin/sh
# Bootstrap this repo for the plans workflow. Idempotent; re-run any time.
#   curl -fsSL ${origin}/start | sh
set -e

ORIGIN='${origin}'
ok() { printf '  \\033[32m✓\\033[0m %s\\n' "$1"; }

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

# 1. Install the plans skill (served by the app itself — no npx, no auth).
mkdir -p .claude/skills/plans
if [ -f .claude/skills/plans/SKILL.md ]; then
  ok "skill already installed (.claude/skills/plans/SKILL.md)"
else
  curl -fsSL "$ORIGIN/start/skill" -o .claude/skills/plans/SKILL.md
  ok "installed the plans skill"
fi

# 2. Point agents at the workflow via AGENTS.md (create, or append once).
if [ -f AGENTS.md ] && grep -q '${AGENTS_BLOCK_START}' AGENTS.md; then
  ok "AGENTS.md already references plans"
else
  [ -f AGENTS.md ] && [ -s AGENTS.md ] && printf '\\n' >> AGENTS.md
  cat >> AGENTS.md <<'PLANS_AGENTS_BLOCK'
${AGENTS_BLOCK}
PLANS_AGENTS_BLOCK
  ok "updated AGENTS.md"
fi

# 3. Bootstrap the plans/ directory (only if it doesn't exist yet).
if [ -d plans ]; then
  ok "plans/ already exists — leaving it untouched"
else
  for s in backlog ready in-progress done; do
    mkdir -p "plans/$s"
    : > "plans/$s/.gitkeep"
  done
  cat > plans/README.md <<'PLANS_README'
${PLANS_README_TEMPLATE}PLANS_README
  ok "bootstrapped plans/ (backlog, ready, in-progress, done)"
fi

printf '\\n\\033[1mDone.\\033[0m Next:\\n'
printf '  • Commit it:   git add .claude AGENTS.md plans && git commit -m "chore: enable plans workflow"\\n'
printf '  • Discover it: install the GitHub App on this repo → %s\\n' "$ORIGIN"
printf '  • Start:       run /plans in your agent\\n'
`
}
