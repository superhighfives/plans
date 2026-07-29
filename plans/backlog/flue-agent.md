---
title: Flue agent — codebase-aware, conversational plan authoring
status: Backlog
created: 2026-07-28
updated: 2026-07-28
---

# Flue agent — codebase-aware, conversational plan authoring

## Goal

Give the CMS a per-repo conversational agent ("Flue") that (a) has real context of the repo's codebase, so the plans it drafts are grounded in what's actually there, and (b) can ask the user clarifying questions mid-flow — woven into the existing "create backlog item" and "move" steps — instead of a single blind one-shot completion. Built on the Cloudflare Agents SDK so sessions are durable and resumable.

## Context

The shipped CMS (Phases 0–4, see `plans/done/plans-cms.md`) does plan authoring as **one-shot** AI calls: the model gets the plan body plus a little typed context and returns a rewrite. Two limits fall out of that:

- **No codebase awareness.** The model only sees the plan text, not the repo. A backlog item like "Add a test framework" can't reason about the actual language/stack/existing config, so it stays generic — accurate but unable to say *which* framework fits *this* repo. (This is exactly the current New-backlog preview: a sensible-but-generic sketch.)
- **No back-and-forth.** If the idea is ambiguous the model guesses, or leaves an open question. It can't ask *me* "which of these two directions?" and fold my answer in before drafting.

This plan closes both: Flue reviews the repo, and turns create/move into a short conversation that can ask questions and then produce the same rich-preview-and-commit artifact we already have. Interaction should feel like an extension of the existing preview UI (the New-backlog / move preview), not a separate chat silo — the conversation *informs* the same approve-before-commit output.

## Approach

Built on **Cloudflare Agents** (<https://developers.cloudflare.com/agents/>) — the `Agent` class (Durable-Object-backed) gives durable, resumable session state, scheduling, WebSockets, and React hooks (`useAgent`), and composes with Workflows for long runs. Rough shape, to be firmed up in a design pass:

- **Session / runtime.** One Agent (Durable Object) per conversation, scoped per-repo (or per-plan). It holds the transcript + working state so a conversation resumes. Live UI over WebSocket / `useAgent`.
- **Codebase context.** Grab the repo and review it to inform authoring. Options to weigh:
  - **Container / Sandbox SDK** with an ephemeral clone (the "artefact") — full fidelity: the agent can read files, run tooling, grep. Heaviest.
  - **GitHub API on demand** — fetch the tree + selected files (README, package manifests, config) without a clone. Lighter; likely enough for "which test framework fits this repo".
  - **Index / embeddings** (Vectorize) for larger repos. Later.
  - Likely start with on-demand GitHub fetch and escalate to a container when a task genuinely needs to run code.
- **Interactive Q&A.** Extend the create-backlog and move flows so the agent can emit clarifying questions, the user answers inline, and it iterates before producing the preview. The final artifact still flows through the **existing rich-preview-and-commit path**, so nothing lands without approval.
- **Long / multi-step runs** (clone → review → draft) go through **Workflows** for durability.
- **Same commit path.** Agent-proposed edits reuse `commitPlanMove` / `commitNewBacklog` — App-authored commits, audit-logged, base-SHA guarded.

## Tasks

- [ ] Design pass: agent runtime shape (Agents SDK `Agent`/DO), session scoping (repo vs plan), and codebase-context strategy (API fetch vs container vs index).
- [ ] Stand up a minimal Agent (DO) with a persisted transcript and a WebSocket / `useAgent` UI surface.
- [ ] Codebase context v1: fetch repo tree + key files on demand and feed them into the authoring prompts.
- [ ] Make "create backlog item" conversational: agent can ask questions, user answers, then it produces the existing preview.
- [ ] Make "move" conversational the same way.
- [ ] Wire agent-proposed edits through the existing preview-and-commit path.
- [ ] Workflows for long clone/review/draft runs.
- [ ] (If needed) container / Sandbox path for tasks that must run code.

## Open questions

- **Codebase-context depth:** is on-demand GitHub fetch enough, or do the common cases need a real clone in a container? Cost/latency tradeoff at "hundreds of repos"?
- **Session scope:** one agent per repo, or per plan/conversation? How long do sessions live; where does the transcript persist (DO storage vs the `chat_sessions`/`chat_messages` D1 tables already sketched in the CMS plan)?
- **Q&A UX:** how do questions surface in the existing preview UI — inline in the create/move panel, or a side conversation that feeds it?
- **Escalation trigger:** what makes a task go from API-only to spinning up a container?
- **Cost / quotas:** agent runs + containers are heavier than one-shot calls — this needs to land alongside the quota work in `plans/backlog/multi-user-and-launch.md`.
- **Grounding guarantees:** keep the same "don't fabricate files/APIs" discipline as the current prompts, now with real repo access to check against.
