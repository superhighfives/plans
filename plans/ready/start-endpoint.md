---
title: One-command repo bootstrap (/start)
status: Ready
created: 2026-07-21
updated: 2026-07-21
---

# One-command repo bootstrap (`/start`)

## Goal

Let anyone (a human in a terminal, or an agent) turn a fresh repo into a
plans-enabled repo with a single command:

```sh
curl -fsSL plans.superhighfives.com/start | sh
```

It installs the `plans` skill into the repo, wires up `AGENTS.md`, and
bootstraps the `plans/` directory — so the repo is immediately ready for the
`/plans` workflow and for discovery by this app.

## Context

Today, bootstrapping a repo is a manual multi-step chore: install the skill via
the `skills` CLI (which needs SSH auth because `superhighfives/plans` is
private), hand-write an `AGENTS.md`, then run `/plans` to lay down the
directory structure. See [Planning CMS](plans-cms.md) for the app this feeds.

Key insight: **the app already contains the skill** — it's deployed from this
repo, which has `skills/plans/SKILL.md`. So the app can serve its own skill
content. That makes `/start` fully self-contained: no `npx`, no `skills` CLI,
no private-repo auth, no network dependency beyond this app itself.

The endpoint must be **public and unauthenticated** — an agent in a brand-new
repo has no session. It serves only public, non-sensitive content (a skill file
and a shell script), so this is safe.

## Approach

Two routes under `src/routes/api/**` (raw `Response`, per the architecture
rules), fronted by friendlier paths:

- **`GET /start`** → `text/plain` POSIX shell script. The script:
  1. Writes `.claude/skills/plans/SKILL.md`, fetched from `/start/skill`.
  2. Creates `AGENTS.md` if absent, or appends a delimited `plans` section if
     present (idempotent — re-running doesn't duplicate the block).
  3. Bootstraps `plans/{backlog,ready,in-progress,done}/.gitkeep` and a seeded
     `plans/README.md`, only if `plans/` doesn't already exist.
  4. Prints next steps: the dashboard URL and the "install the GitHub App on
     this repo" link so the app can discover it.
- **`GET /start/skill`** → `text/markdown`, the verbatim contents of
  `skills/plans/SKILL.md`. Import it as a Vite `?raw` asset so it ships in the
  Worker bundle (same trick as `states.skill.test.ts`) — no filesystem reads at
  runtime.

Seed content (the `plans/README.md` template and the `AGENTS.md` block) lives in
`src/lib/plans/` as string templates so it's testable and shared. The
`AGENTS.md` block uses HTML-comment delimiters (`<!-- plans:start -->` …
`<!-- plans:end -->`) so append/replace is deterministic.

The script must be POSIX `sh` (not bash), fail loudly (`set -e`), never clobber
existing files, and be safe to re-run (idempotent).

## Tasks

- [ ] `GET /start/skill` — serve `skills/plans/SKILL.md` via `?raw` import.
- [ ] `GET /start` — serve the bootstrap script; template the app origin in.
- [ ] `plans/README.md` seed + `AGENTS.md` block as tested string templates.
- [ ] Idempotency: re-running `/start` is a no-op on already-bootstrapped repos.
- [ ] Unit tests: script contains the right paths; skill route matches the file
      (extend the drift-guard idea); AGENTS.md append vs create.
- [ ] README: document `curl … | sh` and the "run it with an agent" phrasing.

## Open questions

- **Multi-agent install.** v1 targets Claude Code (`.claude/skills/`). Do we
  also write opencode's dir, or detect agents? Lean: Claude Code only for v1,
  note the extension point.
- **Agent-native variant.** Should `/start` content-negotiate — shell script for
  `curl`, a markdown runbook for a browser/agent WebFetch? Lean: script only for
  v1; add the runbook if the agent flow feels clunky.
- **Skill freshness.** The copied `SKILL.md` is a point-in-time snapshot. Do we
  want a `plans update` path later, or is re-running `/start` enough? Lean:
  re-run is enough for now.
