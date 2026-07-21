---
title: One-command repo bootstrap (/start)
status: Complete
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

- [x] `GET /start/skill` — serve `skills/plans/SKILL.md` via `?raw` import.
- [x] `GET /start` — serve the bootstrap script; origin from the request URL.
- [x] `plans/README.md` seed + `AGENTS.md` block as tested string templates.
- [x] Idempotency: re-running `/start` is a no-op on already-bootstrapped repos.
- [x] Unit tests: script contents, state dirs, heredoc quoting, AGENTS block.
- [x] README: document `curl … | sh` and the "run it with an agent" phrasing.

## Overview

Shipped `plans.superhighfives.com/start` — a public endpoint that turns any repo
into a plans-enabled repo with one command:

```sh
curl -fsSL plans.superhighfives.com/start | sh
```

It installs the `plans` skill into `.claude/skills/plans/`, adds a delimited
`plans` section to `AGENTS.md` (creating it if absent), and bootstraps
`plans/{backlog,ready,in-progress,done}/` with a seeded `README.md`. The script
is POSIX `sh`, fail-fast, never clobbers, and is safe to re-run. An agent runs
the exact same `curl` via its shell, so "run `plans.superhighfives.com/start`"
just works.

## Architecture

- **`src/lib/plans/bootstrap.ts`** — pure, testable templates: `AGENTS_BLOCK`
  (with `<!-- plans:start/end -->` delimiters), `PLANS_README_TEMPLATE`, and
  `renderStartScript(origin)` which composes them into the shell script via
  quoted heredocs (no accidental expansion of embedded content).
- **`src/routes/start/index.ts`** (`GET /start`) — renders the script with the
  origin taken from the request URL, so it self-references correctly in prod and
  in local dev without reading `APP_URL`.
- **`src/routes/start/skill.ts`** (`GET /start/skill`) — serves
  `skills/plans/SKILL.md` bundled as a `?raw` import (same trick as
  `states.skill.test.ts`), so the app distributes its *own* skill. This is the
  key deviation-that-paid-off: it removes the `skills` CLI, `npx`, and the
  private-repo SSH auth entirely — `/start` depends only on the app itself.
- **Tests** — `bootstrap.test.ts` asserts script shape, idempotency guards,
  state dirs (derived from `PLAN_STATE_DEFS`), and heredoc quoting. Verified
  end-to-end against the dev server: fresh bootstrap, a clean idempotent re-run
  (AGENTS block stays single), and append-to-existing-`AGENTS.md`; script passes
  `sh -n`.

Both endpoints are intentionally **public and unauthenticated** — an agent in a
brand-new repo has no session, and the served content (a skill file, a shell
script) is non-sensitive.

### Open questions carried forward (v1 leanings)

- **Multi-agent install.** v1 targets Claude Code (`.claude/skills/`) only;
  writing opencode/other agent dirs is a later extension.
- **Agent-native variant.** Script-only for now; a content-negotiated markdown
  runbook can be added if the agent flow feels clunky.
- **Skill freshness.** The copied `SKILL.md` is a point-in-time snapshot;
  re-running `/start` re-pulls it. A dedicated `plans update` path is deferred.
