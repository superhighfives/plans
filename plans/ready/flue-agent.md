---
title: Flue agent — codebase-aware, conversational plan authoring
status: Ready
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
