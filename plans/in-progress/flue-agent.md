---
title: Flue agent — codebase-aware, conversational plan authoring
status: In Progress
created: 2026-07-28
updated: 2026-07-28
---

# Flue agent — codebase-aware, conversational plan authoring

## Goal

Give the CMS a per-repo conversational agent ("Flue") that (a) has real context of the repo's codebase, so the plans it drafts are grounded in what's actually there, and (b) can ask the user clarifying questions mid-flow — woven into the existing "create backlog item" and "move" steps — instead of a single blind one-shot completion. Built on the Cloudflare Agents SDK so sessions are durable and resumable.

## Context

The shipped CMS (Phases 0–4, `plans/done/plans-cms.md`) authors plans as **one-shot** AI calls: the model gets the plan text plus a little typed context and returns a rewrite. Two limits fall out of that:

- **No codebase awareness.** The model sees the plan text, not the repo — so "Add a test framework" stays generic, unable to say which framework fits *this* stack.
- **No back-and-forth.** Ambiguous ideas get a guess or an open question; the model can't ask *me* and fold the answer in before drafting.

This is also the CMS's first **stateful/agentic** feature. It reuses two things wholesale: the **Workers AI binding** transport (`env.AI.run("anthropic/…", …, { gateway })`, tool-calling included — new-backlog's forced tool-use already works live) and the **rich preview-and-commit path** (`commitPlanMove` / `commitNewBacklog`, App-authored, audited, base-SHA guarded). Flue adds repo context and a conversation *in front of* that path; it does not change the write path.

## Progress

**Slice 1 — agent scaffold + WebSocket round-trip: DONE.**
- `src/agents/flue-agent.ts` — `FlueAgent extends Agent` (Agents SDK); echoes messages (no AI yet).
- `src/server.ts` — **custom Worker entry**: auth-gates `/agents/*`, hands off to `routeAgentRequest`, delegates everything else to the Start handler, and re-exports `FlueAgent`.
- **Auth gate** (`authorizeAgent`): the instance name is `owner~repo` (`~` is illegal in GitHub owner/repo names → unambiguous, slash-free); the gate re-checks `readSession` → `getUserById` → `resolveAccessibleRepo` so the client-chosen name is **not** the boundary. Missing/invalid session → 401; no repo access → 403; malformed instance → 400.
- `wrangler.jsonc` — `main` → `./src/server.ts`; `FlueAgent` DO binding + `new_sqlite_classes` migration `v1`; `env.ts` gains the `FlueAgent` namespace.
- Client: `FluePing` (`useAgent`) in the create panel opens the socket, pings, and shows the echo.

**Verified.** Build emits `FlueAgent` from `dist/server/index.js` + the DO class into the built `wrangler.json`. Runtime (dev): `/agents/flue-agent/foo~bar` → 401 (no session), `…/badinstance` → 400, `/` → 200 (app still serves). typecheck + tests + biome green.

**Deviation from the spec's integration note:** exporting a DO requires the Worker's `main` to *be* our file, so `main` is now `./src/server.ts` (it calls `createStartHandler(defaultStreamHandler)` itself). `tanstackStart({ server: { entry } })` only swaps Start's *internal* handler — confirmed (by grepping the bundle) it does **not** surface the DO export.

**Slice 2 — codebase context v1: DONE (server side).**
- `src/lib/github/tree.ts` — `fetchRepoTree` (full recursive blob tree at a ref).
- `src/lib/plans/codebase.ts` — pure, tested `selectContextPaths` (curates stack/config/docs files; drops source + vendored/generated dirs).
- `src/server/codebase.server.ts` — `fetchContextFiles` reads the curated blobs under a size budget (50 KB/file, 200 KB total).
- `src/server/plans.server.ts` — `findRepoContext` (user-less repo+installation lookup; safe because the socket gate already authorized the user).
- `FlueAgent` now answers a `{type:'context'}` message: resolve repo → installation token → `fetchRepoTree` → **cache-first** (its SQLite `codebase_cache` keyed by tree sha; unchanged tree skips the blob fetches) → replies with the file manifest + `cached` flag. `src/agents/instance.ts` gained a pure `parseInstanceName` (+ tests) so the DO can parse its own `owner~repo` name.
- Client `FluePing` now requests context on connect and shows "read N context files (cached)".
- Verified: typecheck + biome clean, 98 tests (5 new `parseInstanceName` cases), build exports `FlueAgent`. Live end-to-end (real installation token + WebSocket) verifies on the preview env once the OAuth callback is registered.

**Slice 3 — conversational new-backlog: DONE (server side).**
- `src/lib/ai/gateway.ts` — `completeToolTurn`: one turn of a multi-tool conversation, `tool_choice: "any"` so the model must answer via one of the given tools (never prose). Returns the raw content blocks (to echo back next turn) plus the chosen `{id, name, input}`.
- `src/lib/ai/plan-prompts.ts` — `ASK_USER_TOOL` (a single clarifying question) and `buildConversationalBacklogPrompt` (the backlog-stage framing plus the repo's curated codebase context folded into the prompt).
- `src/server/plans.server.ts` — extracted `buildBacklogPreview` (slug/path derivation + frontmatter) out of `proposeNewBacklog` so the one-shot and conversational paths share it; nothing about committing changed.
- `FlueAgent` now handles `{type:'draft_backlog', idea}`: loads the cache-first codebase context (same path as `context`), then loops the model between `ask_user` (pauses, sends `{type:'question'}`, resumed by `{type:'answer'}`) and `emit_backlog_item` (packages the draft via `buildBacklogPreview`, sends `{type:'preview', ...}`). Conversation state lives in-memory per connection id; `onClose` drops it.
- Client: `NewBacklogItem` now drives the whole flow over the Flue socket (replacing the old one-shot `proposeBacklogItem` call and the separate `FluePing` status line) — a question step renders inline when Flue asks one, then lands on the same preview → `commitBacklogItem` approval UI as before.
- Verified: typecheck + biome clean, 103 tests (7 new — `completeToolTurn`, `ASK_USER_TOOL`, `buildConversationalBacklogPrompt`), build exports `FlueAgent`. Live end-to-end (real conversation over the preview env) not yet run.

**Next: slice 4 — conversational move** (same `ask_user` pattern → existing diff preview → `commitPlanMove`).

## Approach

### Decisions (resolving the backlog open questions)

- **Runtime — Agents SDK `Agent`, one instance per repo.** A `FlueAgent` Durable Object keyed by installation + `owner/repo`, so codebase context is fetched/cached once and reused across conversations. Conversations are threads in the agent's SQLite (`this.sql`). (Revisit per-conversation instances if per-repo state grows — see open questions.)
- **Codebase context — API-first, container as escalation.** v1 reads the repo through the existing GitHub installation token: the tree plus a curated set (README, package manifests + lockfiles, config, CI) and any file the agent requests via a tool. Cache it in `this.sql` keyed by the default-branch commit SHA, reusing the plan-cache invalidation model (`push` webhook busts it). Escalate to a **Container / Sandbox with an ephemeral clone** only for tasks that must *run* code (build/test), gated behind a Workflow.
- **Conversation surface — inline in the existing panels.** The create-backlog and move panels gain a conversational step: when the agent needs input it asks (streamed over WebSocket via `useAgent`), the user answers in the same panel, and when it's ready it emits the existing artifact (rendered new-item / move diff) into the current approve-before-commit UI. No separate chat page.
- **Approval + commit — reuse everything.** Agent-proposed edits use the SDK's `waitForApproval()` wired to the existing preview UI, then commit via `commitPlanMove` / `commitNewBacklog`. Nothing new in the write path.
- **State lives in the DO, not D1.** Transcript, threads, and the context cache use the agent's SQLite — dropping the `chat_sessions` / `chat_messages` D1 tables the CMS plan sketched.

### Architecture

```
Browser (create/move panel)
   │  WebSocket via useAgent (agents/react)
   ▼
routeAgentRequest → FlueAgent (Durable Object, per repo)
   ├── this.sql            → transcript + threads + SHA-keyed context cache
   ├── GitHub (installation token) → tree + files (codebase context)
   ├── Workers AI binding  → Claude (provider routing) with typed tools
   ├── waitForApproval()   → existing rich preview / diff UI
   ├── commitPlanMove / commitNewBacklog → App-authored commit (audited)
   └── runWorkflow()       → long runs (clone + review in a Container)
```

### Typed tools the agent exposes

- `list_repo_tree` / `read_file(path)` — codebase context on demand.
- `ask_user(question)` — surface a clarifying question to the panel and await the answer.
- `propose_new_backlog({ title, body })` / `propose_move({ body })` — emit the artifact into the preview-and-commit path.

### Integration notes (TanStack Start on Workers)

- Export the `FlueAgent` DO class; add a `durable_objects` binding + migration in `wrangler.jsonc`.
- Route `/agents/:name/:instance` through `routeAgentRequest` from the Worker entry (a `src/routes/api/agents/$` server route, or the server entry's fetch). **Enforce the user→installation repo-access check** (as `resolveAccessibleRepo` does) on the WebSocket upgrade before handing off — an agent instance is a repo's context and must not be reachable cross-tenant.
- Client: `useAgent` (`agents/react`) in the create/move panels; render questions + streaming, then hand the final artifact to the existing preview components.

### Thin-slice delivery

Each slice ships value on its own:

1. **Agent scaffold** — `FlueAgent` DO, routing, auth gate, a WebSocket round-trip from the create panel (no AI yet).
2. **Codebase context v1** — tree + curated files via the installation token; SHA-keyed cache in `this.sql`; fed into the prompts.
3. **Conversational new-backlog** — `ask_user` loop + `propose_new_backlog` → existing rendered preview → `commitNewBacklog`.
4. **Conversational move** — same pattern → existing (editable) diff preview → `commitPlanMove`.
5. **Container escalation** — Workflow + Sandbox clone for run-code tasks, only when needed.

## Tasks

- [ ] `FlueAgent` Durable Object (Agents SDK) + wrangler binding/migration; exported from the Worker.
- [ ] `routeAgentRequest` wiring + auth (session + user→installation repo-access check) on socket connect.
- [ ] `useAgent` client surface embedded in the create-backlog and move panels.
- [ ] Codebase-context tools (`list_repo_tree`, `read_file`) over the installation token; SHA-keyed cache in `this.sql`, busted on `push`.
- [ ] `ask_user` clarifying-question loop rendered inline in the panel.
- [ ] Conversational **new backlog item**: Q&A → `propose_new_backlog` → existing rendered preview → `commitNewBacklog`.
- [ ] Conversational **move**: Q&A → `propose_move` → existing diff preview (editable) → `commitPlanMove`.
- [ ] `waitForApproval()` gate wired to the preview UI.
- [ ] Container / Sandbox escalation behind a Workflow for run-code tasks.
- [ ] Tests: agent tool handlers, context cache + invalidation, and the Q&A → preview → commit path.

## Open questions

- **Per-repo DO scale:** is one agent per repo fine at "hundreds of repos," or does context-cache size / hot-repo contention push us toward per-conversation instances? (Start per-repo; revisit if state grows.)
- **Container trigger:** what concretely flips a task from API-only to a clone-in-container run? (Provisional: only when the user/agent needs to build or run tests.)
- **Context budget:** how much repo content goes into a prompt before cost/latency bites — a curated-files heuristic now vs. a retrieval/index step (Vectorize) later.
- **Cost / quotas:** agent runs (and containers) are heavier than one-shot calls; this needs to land alongside the quota work in `plans/backlog/multi-user-and-launch.md`.
