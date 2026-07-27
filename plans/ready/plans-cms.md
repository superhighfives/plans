---
title: Planning CMS
status: Ready
created: 2026-07-19
updated: 2026-07-26
---

## Goal

A multi-tenant web app on Cloudflare that reads the `plans/` directories across a user's GitHub repos (the ones that use the [`plans`](../../skills/plans/SKILL.md) skill) and lets them browse, edit, move, and converse with each repo's plans — with AI assistance and every change written back as a git commit. Built product-shaped, shipped in thin phases starting with a read-only reader.

## Current status (2026-07-26)

**Phases 0–3 are shipped and merged** (PR #10); **Phase 4 is built** (on branch `phase-4-new-backlog-items`, pending review). The app can: log in, list repos with `plans/`, browse plans by state, render a plan, **hand-edit** a plan and commit it back (Editor/Preview toggle, base-SHA conflict guard), **move** a plan between states with Claude drafting the rewrite through Cloudflare AI Gateway → diff preview → atomic move-and-update commit, and **create a new backlog item** from a rough idea (Claude proposes a title + body → rendered preview → App-authored commit into `plans/backlog/`).

**Next up: Phase 5** — Flue chat (agentic): a per-repo conversation in a Cloudflare sandbox with an ephemeral clone, session state in a Durable Object, and agent-proposed edits flowing through the same rich-preview-and-commit path. A much larger lift (sandbox, Durable Object, Workflows) than Phases 2–4.

Key new code from Phase 4: `buildNewBacklogPrompt` + `NEW_BACKLOG_TOOL` in `src/lib/ai/plan-prompts.ts` (structured title+body via forced tool-use), `completeStructured` in `src/lib/ai/gateway.ts`, `src/lib/plans/slug.ts` (kebab-case slug + dedupe), `proposeNewBacklog`/`commitNewBacklog` in `src/server/plans.server.ts`, their RPCs in `src/server/repo.functions.ts`, and the `NewBacklogItem` panel on the repo board (`src/routes/repos/$owner/$repo/index.tsx`).

**Runtime config the deployment needs for the AI/edit features to work live** (code is done; these are operational):
- GitHub App must have **Contents: read & write** granted *and the installation must have accepted it* (Phase 2/3 writes).
- An **authenticated** Cloudflare AI Gateway with **Unified Billing** credits (or a stored BYOK key), plus the three secrets `CF_AI_GATEWAY_ACCOUNT_ID`, `CF_AI_GATEWAY_ID`, `CF_AI_GATEWAY_TOKEN` (local: `.dev.vars`; prod: `wrangler secret put`). No Anthropic key is used — the app authenticates to the gateway via `cf-aig-authorization`.

Key new code from Phases 2–3: `src/lib/ai/` (gateway client + move prompts), `src/lib/github/write.ts` (`putFile` + `createCommit`), the write/move logic in `src/server/plans.server.ts`, its RPCs in `src/server/repo.functions.ts`, and the editor + move UI in `src/routes/repos/$owner/$repo/plan/$.tsx`.

## Context

The `planning` skill stores implementation specs as markdown in a `plans/` directory, split into `backlog/`, `ready/`, `in-progress/`, and `done/`. Each plan has YAML frontmatter (`title`, `status`, `created`, `updated`) and a body. Today the only way to work with these is a terminal in each repo. This project puts a UI over all of them at once.

GitHub is the source of truth for plan content. The CMS never owns the plans — it reads and writes them through the GitHub API, and every mutation is a commit. The app's own database (D1) holds only app state and caches.

### Decisions

Settled during the kickoff review:

- **v1 is a reader.** Log in, list repos that have a `plans/` folder, browse plans by state. Editing, AI, and chat come in later phases.
- **Repo discovery is automatic.** Scan the repos the GitHub App is installed on for a top-level `plans/` directory; show any that have one. **Detect-and-skip:** only top-level `plans/` with the skill's standard frontmatter is recognized in v1; anything else is silently ignored. Configurable paths / lenient parsing can come later if needed.
- **Writes are direct commits to the default branch.** Each action (edit, move, create) is one commit to `main`. No PR flow.
- **Commits are authored as the GitHub App (bot).** Clear that the CMS made them; the audit log ties each commit back to the user who triggered it.
- **Auth: GitHub App only.** The App handles login (user OAuth) and repo access (installation tokens). Already multi-tenant via per-user/org installations. **Clerk is deferred indefinitely** — no billing is expected — but the session layer stays thin enough that an identity provider could be slotted in later without a rewrite.
- **AI: Claude via Cloudflare AI Gateway with unified billing.** Cloudflare routes and bills the provider calls; private plan/code content flows through freely. Flue uses the same gateway.
- **"Artefacts" = ephemeral git repos.** Used as the Flue agent's working copy for chat. Plus **rich AI previews** (approve-before-commit) and **Workflows / Queues** for durable background jobs (repo scans, long AI runs).
- **Stack: TanStack Start on Cloudflare Workers.** One full-stack React codebase; server functions call GitHub and AI; TanStack Query for data; D1 for app state.
- **Scale target: medium (hundreds).** Up to a few hundred repos / plans. Repo scans run through Queues; `push` webhooks keep the plan cache fresh.

## Approach

### Architecture at a glance

```
Browser (TanStack Start / React)
        │  TanStack Query
        ▼
TanStack Start server functions (Cloudflare Workers)
        ├── GitHub App          → repo contents + commits (installation tokens)
        ├── Cloudflare AI Gateway → Claude (move/update, new-item, chat) — unified billing
        ├── D1                    → users, installations, repo cache, sessions, audit
        ├── Queues                → repo scans (fan-out)
        ├── Workflows             → long AI runs, multi-step jobs
        └── Flue agent (later)    → ephemeral repo clone in a sandbox / Durable Object
```

**Source of truth:** GitHub. **App state:** D1. Kept in sync by reading fresh from GitHub on demand, caching in D1 against the commit SHA the cache was built from, and invalidating on `push` webhooks.

### Stack

- **Runtime / framework:** TanStack Start deployed to Cloudflare Workers. Server functions are the API boundary — no separate backend.
- **Data fetching:** TanStack Query on the client; server functions do the GitHub/AI calls so tokens never reach the browser.
- **Database:** Cloudflare D1 (SQLite). Drizzle for schema + migrations.
- **Auth:** GitHub App user-OAuth for login; encrypted installation tokens for repo access. Sessions in signed, http-only cookies.
- **AI:** Cloudflare AI Gateway → Claude (latest Opus/Sonnet), unified billing.
- **Background work:** Queues for fan-out (scanning many repos); Workflows for multi-step durable jobs (long AI runs).
- **Agent (later):** Flue, in a Cloudflare sandbox with an ephemeral clone, session state in a Durable Object.

### GitHub integration

A single GitHub App, registered once, installed per-user (or per-org). This is what makes it multi-tenant.

- **Login:** GitHub App user-access-token OAuth flow ("Sign in with GitHub"). Identifies the user.
- **Repo access:** installation access tokens, minted on demand, short-lived, scoped to that installation's repos. Requested permissions: **Contents: read & write**, **Metadata: read**. No more than needed.
- **Discovery:** for each installation, list repos, then check each for a top-level `plans/` directory (Git Trees API on the default branch). Runs as a Queue-driven scan; results cached in D1.
- **Reading a plan:** Contents API (or Trees + blob) → decode → parse frontmatter + body.
- **Writing a plan:** prefer the Git Data API (create blob → tree → commit → update ref) so an edit, a create, or a **move** (delete old path + add new path) is a single atomic commit authored by the App.
- **Conflict safety:** every write carries the base SHA the edit started from. On mismatch, surface a conflict instead of clobbering.
- **Webhooks:** subscribe to `push` and `installation` events — invalidate the repo/plan cache on push; add/remove installations on install/uninstall.

### Data model (D1, first cut)

- `users` — id, github_user_id, login, avatar, created_at.
- `installations` — id, github_installation_id, account_login, account_type (user/org), encrypted token cache + expiry.
- `user_installations` — join table (a user can access multiple installations).
- `repos` — installation_id, full_name, default_branch, has_plans (bool), last_scanned_sha, last_scanned_at.
- `plan_cache` — repo_id, path, state, title, status, updated, body_sha, cached body (optional). Rebuilt from GitHub; never authoritative.
- `chat_sessions` / `chat_messages` — for Flue conversations (or lean on the Durable Object's own stream).
- `audit_log` — user_id, repo_id, action, path(s), commit_sha, at. Every mutation records the user who triggered the bot-authored commit.

Secrets (installation tokens, any cached credentials) encrypted at rest with a key in Workers secrets.

### Phased delivery

**Phase 0 — Foundations.** New repo; TanStack Start scaffold deployed to Workers; D1 + Drizzle wired; GitHub App registered; "Sign in with GitHub" OAuth login; installation linking (user installs the app → store the installation, map it to the user). No plans UI yet — auth + an empty dashboard.

**Phase 1 — Reader (v1).**
- Dashboard lists the user's installations and, under each, the repos that have a `plans/` folder.
- Repo view shows the four states as **lists** (backlog, ready, in-progress, done), populated from the plans.
- Plan view renders the markdown body and shows parsed frontmatter (title, status, dates).
- Read-only. Cached, refreshable, webhook-invalidated. Ships and is genuinely useful on its own.

**Phase 2 — Hand editing + commit.** Markdown editor on the plan view. Save writes back via a direct, App-authored commit to the default branch, with the base-SHA conflict guard. Commit messages templated (e.g. `plans: update <title>`).

**Phase 3 — Move actions with AI.** An explicit **move control** (backlog → ready → in-progress → done, or backwards) plus a **textarea for extra context** — no drag-to-move. The move triggers Claude to update the plan for its new state (promote a backlog idea to a `ready/` spec via the template; add Overview + Architecture on the way to `done/`). If moving to `ready/` while the plan still has open questions, the AI **warns and lets the user override** rather than blocking. Output is shown as a **rich preview / diff**; on approval it's committed as an atomic move-and-update. Frontmatter `status` + `updated` auto-updated.

**Phase 4 — AI-assisted new backlog items.** "New backlog item" flow: user gives a rough idea, Claude fleshes it into a backlog entry (template, `status: Backlog`), preview, approve, commit into `plans/backlog/`.

**Phase 5 — Flue chat (agentic).** Per-repo conversation grounded in the codebase and its `plans/` folder. A Flue agent runs in a Cloudflare sandbox with an ephemeral clone of the repo ("artefact"); session state persists in a Durable Object so conversations resume. **Agentic from the start:** the agent can propose edits that flow through the same rich-preview-and-commit path as Phase 3, so nothing lands without approval. Long runs go through Workflows.

**Phase 6 — Multi-user hardening.** Rate limits, per-user AI quotas, org/team niceties, an audit UI, and polish. Clerk is intentionally **not** in scope — GitHub-App auth is expected to be enough — but the session layer stays swappable in case that changes.

## Tasks

- [x] **Phase 0:** new repo; TanStack Start on Workers; D1 + Drizzle; register GitHub App; user-OAuth login; installation linking; encrypted token storage.
- [x] **Phase 1 (v1):** installation + repo listing; `plans/` auto-detection via scan + cache; repo view (four state lists); plan renderer (frontmatter + markdown); manual refresh; `push` webhook invalidation. *(Discovery runs inline in v1; Queue fan-out is a follow-up — see README.)*
- [x] **Phase 2:** raw-markdown editor on the plan view; App-authored direct-commit write path (Contents API PUT — one atomic commit per edit; the Git Data API is reserved for Phase 3 moves, which touch two paths); base-SHA conflict handling (stale sha → conflict, no clobber); templated commit message (`plans: update <title>`); cache refresh + audit-log row on success.
- [x] **Phase 3:** explicit move control + context textarea; Claude (`claude-opus-4-8`) move/update prompts per transition, run through **Cloudflare AI Gateway** (unified billing); open-questions warn-and-override when promoting to `ready`; rich preview/diff; atomic move-and-update commit via the Git Data API (blob→tree→commit→ref, non-forced), base-SHA guarded; frontmatter `status` + `updated` set deterministically server-side (the model only rewrites the body).
- [x] **Phase 4:** new-backlog-item flow — rough idea → Claude proposes a title + rough body via forced tool-use (`completeStructured` + `NEW_BACKLOG_TOOL`); deterministic kebab-case filename (`slugify` + `uniqueSlug`, deduped within `backlog/`); frontmatter (`status: Backlog`, `created`/`updated` today) attached server-side; rendered preview; create-only `putFile` commit (422 → "already exists" guard); audit-log `plan.create` row + cache seed.
- [ ] **Phase 5:** Flue agent in a sandbox with ephemeral clone; Durable Object session persistence; agentic edits through the preview path; Workflows for long runs.
- [ ] **Phase 6:** AI quotas + rate limits; org/team support; audit UI; polish.
- [x] **Cross-cutting (partial):** AI Gateway client (unified-billing auth via `cf-aig-authorization`) + secrets wired; tests for the GitHub read/write path (`fetchContentFile`, `putFile`, `createCommit`), the move prompts, and the gateway client. *Still open:* per-repo error/empty/loading polish and broader server-orchestration test coverage (no D1/token test harness exists yet).
