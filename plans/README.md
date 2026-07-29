# Plans

Implementation plans for the Planning CMS, one markdown file per unit of work,
managed with the [`plans`](../skills/plans/SKILL.md) workflow. Plans move through
four states, one per subdirectory:

- **backlog/** — rough ideas, unscoped. Not ready to work on.
- **ready/** — fully specced; anyone (human or agent) could pick it up.
- **in-progress/** — actively being implemented.
- **done/** — shipped, with a record of what was actually built.

Normal flow is one-directional: backlog → ready → in-progress → done.

## Naming

kebab-case filenames that describe the work (`flue-agent.md`). Names stay stable
across the lifecycle; only the directory changes.

## Frontmatter

Every plan starts with YAML frontmatter:

    ---
    title: Flue agent
    status: Backlog        # Backlog | Ready | In Progress | Complete
    created: 2026-07-28
    updated: 2026-07-28
    ---

`status` mirrors the directory; keep `updated` current when you touch a file.

## Current plans

- **done/plans-cms.md** — the reader/editor/AI CMS (Phases 0–4). Shipped.
- **done/start-endpoint.md** — the `curl | sh` bootstrap endpoint. Shipped.
- **backlog/flue-agent.md** — codebase-aware conversational agent (Flue). Next big feature.
- **backlog/multi-user-and-launch.md** — quotas, rate limits, audit UI, launch.
