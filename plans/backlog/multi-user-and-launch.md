---
title: Multi-user hardening & launch
status: Backlog
created: 2026-07-28
updated: 2026-07-28
---

# Multi-user hardening & launch

## Goal

Take the CMS from "works for me" to "safe for other people to use," and get it properly live. The auth model is already multi-tenant (GitHub App, per-user/org installations); this phase adds the guardrails, operational polish, and launch steps needed before anyone else is on it.

## Context

Today it's a single user (me). The read/edit/AI features (Phases 0–4, `plans/done/plans-cms.md`) and the conversational **Flue agent** (Phase 5, `plans/done/flue-agent.md`) are both shipped and working live. Before opening the app up beyond one user, it needs the things a single-user tool can skip: cost controls on the AI calls, rate limiting, an audit surface, and org/team niceties. **Clerk stays out of scope** — GitHub-App auth is expected to be enough — but the session layer stays thin/swappable in case that changes.

## Approach

- **Per-user AI quotas.** Cap AI spend per user/period across moves, new items, and especially Flue agent runs (heavier). Track usage; surface remaining quota.
- **Rate limits.** Per-user / per-installation limits on the mutating + AI endpoints to prevent runaway cost and abuse.
- **Audit UI.** Surface the existing `audit_log` (who triggered which bot-authored commit, when, which paths) as viewable history — per repo and per user.
- **Org / team support.** Niceties for org installations: seeing who else has access, team-level views.
- **Operational readiness / launch.** Turn the runtime config into documented settings (GitHub App Contents:write accepted; the `ai` binding + `CF_AI_GATEWAY_ID`; secrets), add health/observability, finish the per-repo error/empty/loading polish, and actually go live.

## Tasks

- [ ] Per-user AI usage tracking + quotas (including Flue agent runs).
- [ ] Rate limiting on mutating + AI endpoints.
- [ ] Audit-log UI (per repo, per user).
- [ ] Org/team views for shared installations.
- [ ] Per-repo error/empty/loading-state polish (carried over from the CMS cross-cutting work).
- [ ] Broader server-orchestration test coverage (no D1/token test harness exists yet).
- [ ] Launch checklist: config docs, observability, then open it up.

## Open questions

- Where do quota / rate-limit counters live — D1, a Durable Object, or Cloudflare's rate-limiting binding?
- What's the quota model — per-user credits, per-period caps, or tied to Unified Billing spend?
- Does opening up to others change the "Clerk deferred" call, or does GitHub-App auth genuinely suffice?
- What's the minimum bar for "live" — just me plus a couple of trusted users, or public sign-up?
