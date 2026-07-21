/**
 * Content and script templates for the `/start` bootstrap endpoint.
 *
 * Kept here (pure, no I/O) so the routes stay thin and everything is unit
 * testable. `renderStartScript` produces the POSIX `sh` script served to
 * `curl`; `renderStartPage` is the HTML shown to browsers/agents; the skill
 * itself is served separately at `/start/skill`.
 */

/**
 * Where the skill is installed, most-canonical first. `.agents/skills/` is the
 * cross-agent convention (opencode and other `.agents`-aware tools read it);
 * `.claude/skills/` is Claude Code's. Mirrors what the `skills` CLI lays down
 * for a project-level `--copy` install, so the result is identical — minus the
 * CLI, npx, and private-repo auth.
 */
export const AGENT_SKILL_DIRS = ['.agents/skills/plans', '.claude/skills/plans']

/** Canonical path used when pointing docs at the installed skill. */
const CANONICAL_SKILL_PATH = `${AGENT_SKILL_DIRS[0]}/SKILL.md`

/** HTML-comment delimiters so the AGENTS.md block can be found and replaced. */
export const AGENTS_BLOCK_START = '<!-- plans:start -->'
export const AGENTS_BLOCK_END = '<!-- plans:end -->'

/** The block appended to (or created as) a repo's AGENTS.md. */
export const AGENTS_BLOCK = `${AGENTS_BLOCK_START}
## Plans workflow

This repo manages implementation specs with the **plans** workflow: specs live
in \`plans/{backlog,ready,in-progress,done}/\`. Use the \`plans\` skill — run
\`/plans\`, or read \`${CANONICAL_SKILL_PATH}\` — to create, start, and finish
plans. \`plans/README.md\` is the source of truth once bootstrapped.
${AGENTS_BLOCK_END}`

/** Seed content for a freshly bootstrapped repo's `plans/README.md`. */
export const PLANS_README_TEMPLATE = `# Plans

Implementation plans for this repo as markdown files, one per unit of work,
managed with the [\`plans\`](../${CANONICAL_SKILL_PATH}) workflow. Plans move
through four states, one per subdirectory:

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

Run \`/plans\` (or read the skill) to create, start, and finish plans. This
README is the source of truth for this repo and wins over the skill if they
differ.
`

/**
 * Render the POSIX `sh` bootstrap script for a given app origin (no trailing
 * slash). Two verbs:
 *   - (default) bootstrap — install skill + AGENTS.md + plans/ dirs, idempotent.
 *   - update — re-pull the skill into every agent dir, overwriting.
 *
 * Safe to re-run; never clobbers existing content. `origin` is interpolated as
 * a shell single-quoted string, so it must not contain a single quote (an app
 * origin never does).
 */
export function renderStartScript(origin: string): string {
  const skillDirs = AGENT_SKILL_DIRS.join(' ')
  return `#!/bin/sh
# Bootstrap this repo for the plans workflow. Idempotent; re-run any time.
#   curl -fsSL ${origin}/start | sh              # bootstrap
#   curl -fsSL ${origin}/start | sh -s -- update # refresh the skill only
set -e

ORIGIN='${origin}'
CMD="\${1:-bootstrap}"
SKILL_DIRS="${skillDirs}"
ok() { printf '  \\033[32m✓\\033[0m %s\\n' "$1"; }

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

fetch_skill() { # $1 = target dir
  mkdir -p "$1"
  curl -fsSL "$ORIGIN/start/skill" -o "$1/SKILL.md"
}

# --- update: refresh the skill in every agent dir, then stop ------------------
if [ "$CMD" = "update" ]; then
  for d in $SKILL_DIRS; do
    fetch_skill "$d"
    ok "refreshed $d/SKILL.md"
  done
  printf '\\n\\033[1mUpdated.\\033[0m Skill re-pulled from %s\\n' "$ORIGIN"
  exit 0
fi

# --- bootstrap (default) ------------------------------------------------------
# 1. Install the plans skill for every agent (served by the app — no npx/auth).
for d in $SKILL_DIRS; do
  if [ -f "$d/SKILL.md" ]; then
    ok "skill already installed ($d/SKILL.md)"
  else
    fetch_skill "$d"
    ok "installed the plans skill ($d/SKILL.md)"
  fi
done

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
printf '  • Commit it:   git add .agents .claude AGENTS.md plans && git commit -m "chore: enable plans workflow"\\n'
printf '  • Discover it: install the GitHub App on this repo → %s\\n' "$ORIGIN"
printf '  • Start:       run /plans in your agent\\n'
printf '  • Later:       curl -fsSL %s/start | sh -s -- update  (refresh the skill)\\n' "$ORIGIN"
`
}

/**
 * Minimal, self-contained HTML shown when a browser or agent requests `/start`
 * with `Accept: text/html`. Doubles as a readable runbook: the text content
 * survives being scraped to plain text by an agent's fetch. Theme-aware.
 */
export function renderStartPage(origin: string): string {
  const cmd = `curl -fsSL ${origin}/start | sh`
  const update = `curl -fsSL ${origin}/start | sh -s -- update`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Plans — bootstrap a repo</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 42rem; margin: 4rem auto;
         padding: 0 1.25rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  p.lede { opacity: .75; margin-top: 0; }
  pre { background: color-mix(in srgb, currentColor 8%, transparent); padding: 1rem;
        border-radius: .5rem; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  ul { padding-left: 1.2rem; }
  .muted { opacity: .7; font-size: .9rem; }
  a { color: inherit; }
</style>
</head>
<body>
  <h1>Plans</h1>
  <p class="lede">Turn any repo into a plans-enabled repo with one command.</p>
  <pre><code>${cmd}</code></pre>
  <p>It installs the <code>plans</code> skill for your agents, wires up
     <code>AGENTS.md</code>, and creates
     <code>plans/{backlog,ready,in-progress,done}/</code> with a seeded README.
     It's idempotent and never clobbers existing files.</p>
  <ul>
    <li>Working with an agent? Just say <em>"run ${origin}/start in this repo"</em>.</li>
    <li>Installs for Claude Code (<code>.claude/skills/</code>) and the shared
        <code>.agents/skills/</code> convention (opencode et al.).</li>
    <li>Refresh the skill later: <pre><code>${update}</code></pre></li>
  </ul>
  <p class="muted">The app serves its own skill at
     <a href="${origin}/start/skill">/start/skill</a>, so this has no dependency
     beyond the app itself.</p>
</body>
</html>
`
}
