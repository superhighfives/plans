---
name: planning
description: >-
  Use when working on a project that uses a plans/ directory to manage
  implementation specs through a backlog → ready → in-progress → done lifecycle,
  or when the /planning slash command is invoked. Covers bootstrapping the
  directory structure, brainstorming new ideas, promoting them to specs,
  starting and finishing work, tidying, and documenting what was actually built.
metadata:
  author: superhighfives
  version: "2.0.0"
---

# Planning

Projects that use this workflow keep implementation plans as markdown files in a `plans/` directory. Plans move through four states, one per subdirectory: `backlog/`, `ready/`, `in-progress/`, `done/`. `plans/README.md` is the canonical documentation for a given project - always defer to it over this skill if they conflict.

## Bootstrap (if the structure doesn't exist)

If the project has no `plans/` directory yet, create it before doing anything else:

```
plans/
├── README.md
├── backlog/.gitkeep
├── ready/.gitkeep
├── in-progress/.gitkeep
└── done/.gitkeep
```

Each subdirectory gets an empty `.gitkeep` so git tracks it while empty. Seed `plans/README.md` with the lifecycle, naming convention, template, and frontmatter described below - it becomes the source of truth going forward.

## Lifecycle

- **backlog/** - rough ideas, unscoped. Not ready to work on.
- **ready/** - fully specced. Anyone (human or agent) could pick it up.
- **in-progress/** - actively being implemented. Should be updated as decisions are made.
- **done/** - shipped. Includes an accurate record of what was actually built.

Movement is one-directional in the normal case: `backlog → ready → in-progress → done`. Moving backwards is fine if scope changes or work is paused - just update `status` and `updated` accordingly.

## Naming

Plans use kebab-case filenames that describe the work: `add-oauth-login.md`, `refactor-queue-consumer.md`. Names stay stable across the lifecycle; only the directory changes.

## Frontmatter

Every plan starts with YAML frontmatter:

```yaml
---
title: Add OAuth login
status: Ready         # Backlog | Ready | In Progress | Complete
created: 2026-07-01
updated: 2026-07-17
---
```

`status` mirrors the directory. Keep `updated` current when you touch the file.

## Template

```markdown
---
title: <short title>
status: Ready
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Title>

## Goal
One or two sentences on what this plan achieves and why.

## Context
Background, constraints, links to related plans, issues, or discussions.

## Approach
The intended implementation - detail should match the risk of the work. Enough that someone else could pick it up.

## Tasks
- [ ] High-level checklist of the work.

## Open questions
Anything unresolved. Resolve or delete these before moving to `ready/`.
```

## Working on a plan

Before starting significant work:

1. Check `plans/ready/` for an existing spec that matches the task. If one exists, use it - don't re-plan from scratch.
2. Move the file to `plans/in-progress/` and set `status: In Progress`.
3. Keep the plan honest as you work. When a decision changes the approach, update the plan. Don't let it drift silently.

## Finishing a plan

When implementation is complete:

1. Move the file to `plans/done/`.
2. Set `status: Complete` and update `updated`.
3. Add two sections documenting what actually shipped:

```markdown
## Overview
What was built, in a few sentences. Written for someone reading this a year from now who wasn't involved.

## Architecture
How the pieces fit together, key files or modules, and any deviations from the original approach - with reasons. Deviations are the most valuable part; capture them honestly.
```

A `done/` plan that matches the spec exactly is fine. A `done/` plan that pretends there were no deviations when there were is worse than no plan at all.

## Modes (via `/planning`)

If a `/planning` slash command is wired up, it dispatches to one of these modes. Each mode should first check that `plans/` is bootstrapped and create it if not.

### `/planning --help`
Print a concise summary of the workflow and every mode, then stop. Don't touch `plans/` or bootstrap anything - `--help` is read-only. Output the table below verbatim (adjust wording only if `plans/README.md` overrides it):

```
/planning                         Show status: counts per directory, in-progress plans, tidy warnings.
/planning --help                  Show this help.
/planning --new <idea>            Rough out a new idea into plans/backlog/ (alias: --brainstorm).
/planning --prepare <idea|file>   Promote a backlog idea or fresh idea into a full spec in plans/ready/.
/planning --start <plan-name>     Move a ready plan to plans/in-progress/ and begin implementation.
/planning --finish [plan-name]    Move an in-progress plan to plans/done/ with Overview + Architecture.
/planning --tidy                  Audit plans/: validate frontmatter, statuses, staleness, structure.

Lifecycle: backlog → ready → in-progress → done (one subdirectory each).
plans/README.md is the source of truth for a project and wins over this skill.
```

### `/planning` (no flag) - status
Show a summary: counts per directory, list of `in-progress/` plans with their `updated` dates, and any tidy warnings. Bootstrap the structure if missing.

### `/planning --tidy`
Audit `plans/` and fix or flag:
- Frontmatter present and valid on every plan.
- `status` matches the directory the file lives in.
- `updated` is not obviously stale for `in-progress/` items (flag anything older than ~2 weeks).
- No files sitting outside the four subdirectories.
- `done/` entries have Overview and Architecture sections.

Fix mechanical issues directly. Surface judgement calls (stalled work, missing docs) as a list for the human.

### `/planning --new <idea>` (alias: `--brainstorm`)
Explore intent first (use a brainstorming skill if one is available), then write a short plan into `plans/backlog/` with `status: Backlog`. Keep it rough - backlog entries are ideas, not specs.

### `/planning --prepare <idea-or-backlog-file>`
Promote an idea (either a `backlog/` file or a fresh idea from the argument) into a full spec in `plans/ready/` using the template above. Resolve any open questions before saving as ready.

### `/planning --start <plan-name>`
1. Locate the plan in `plans/ready/` (or `backlog/` if the user is skipping ahead).
2. Move it to `plans/in-progress/`.
3. Set `status: In Progress` and update `updated`.
4. Read the plan and begin implementation. Keep it current as decisions land.

### `/planning --finish [plan-name]`
If no name is given and there's exactly one `in-progress/` plan, use that. Otherwise ask.

1. Move the file to `plans/done/`.
2. Set `status: Complete` and update `updated`.
3. Add Overview and Architecture sections describing what actually shipped, including deviations from the original approach and why.

## Rules

- `plans/README.md` wins over this skill for project-specific details.
- One `in-progress/` plan per stream of work is the norm - if several pile up, something has stalled.
- Don't delete plans from `done/`. They're the historical record.
- If a plan is abandoned, move it to `done/` with `status: Complete` and an Overview explaining why it was dropped, or delete it deliberately - don't leave it rotting in `in-progress/`.
