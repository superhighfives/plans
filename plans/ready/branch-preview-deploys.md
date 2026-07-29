---
title: Branch preview deploys
status: Ready
created: 2026-07-29
updated: 2026-07-29
---

# Branch preview deploys

## Goal

A single, stable preview environment — `plans-preview.superhighfives.com` — that any branch can be deployed to, so a feature (especially the Flue agent, whose Durable Object + AI can't run in local dev) can be exercised on a real, visitable URL and reviewed — by me and by the claude review process — before it lands on `main`.

## Context

Local dev can't fully run the app: Workers AI has no local emulation (the `ai` binding is `remote: true`), and reviewing Flue means driving a live Durable Object + WebSocket. So "does this branch actually work" can only be answered on a deployed environment — and today `main`'s production deploy is the only one, so the only way to see a change live is to ship it to prod.

Two patterns in my other repos: **nylon-impossible** spins up an ephemeral per-PR Worker (`…-pr-<N>.domain`, torn down on close); **records** uses a single stable `-preview` subdomain. For plans the deciding factor is **GitHub OAuth**: login runs through the GitHub App, and GitHub Apps allow only a fixed list of callback URLs (no wildcards) — so per-PR dynamic subdomains can't complete login. A single stable `plans-preview` registers its callback once. → **single stable preview.**

This also sidesteps a current wrinkle: prod `plans` has the `FlueAgent` DO from an earlier deploy, so rolled-back `main` can't deploy (it no longer exports the class). A separate preview Worker has its **own isolated DO namespace** and never touches prod.

## Approach

A wrangler **named environment** `preview` (`wrangler deploy --env preview`) producing a separate Worker `plans-preview` with fully isolated resources:

- **Own DO namespace** — automatic (separate Worker), so the branch's Flue has clean state and prod is untouched.
- **Own D1** (`plans-preview`), same migrations dir.
- **Own custom domain** `plans-preview.superhighfives.com`.
- **Own secrets** + `APP_URL` = the preview origin.

Named environments do **not** inherit bindings, so `env.preview` redeclares `d1_databases`, `durable_objects`, `migrations`, `ai`, and `routes`. `compatibility_date`, `main`, and `observability` are inherited.

**Integration gotcha (verified):** `@cloudflare/vite-plugin` bakes a *single* resolved config into `dist/server/wrangler.json` at build time, so `wrangler deploy --env preview` after a normal build finds no `preview` env and silently targets **prod**. The env is selected at **build** time via `CLOUDFLARE_ENV`:

- **Deploy:** `CLOUDFLARE_ENV=preview npm run build && wrangler deploy` — i.e. `npm run deploy:preview`.
- **Config commands** (`wrangler secret put …`, `wrangler d1 migrations apply …`) read the *source* `wrangler.jsonc`, so for those `--env preview` works directly.

Deploy is **manual / dispatch**, not per-push: the `deploy:preview` script plus a `workflow_dispatch` Action that deploys the selected branch. Run it against whatever branch you're reviewing — first, `flue-agent`.

### One-time setup (account-side — needs your hands)

1. `wrangler d1 create plans-preview` → paste the id into `env.preview.d1_databases[0].database_id` (replacing `REPLACE_WITH_PREVIEW_D1_ID`).
2. `wrangler d1 migrations apply plans-preview --remote --env preview`.
3. Register the preview OAuth callback on the GitHub App: `https://plans-preview.superhighfives.com/api/auth/github/callback` (callback URLs are a list, so the same App works for prod + preview).
4. Set preview secrets: `wrangler secret put <NAME> --env preview` for the GitHub App set + `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CF_AI_GATEWAY_ID`, and `APP_URL=https://plans-preview.superhighfives.com`.
5. `npm run deploy:preview`.

## Tasks

- [ ] `env.preview` in `wrangler.jsonc` (name `plans-preview`, own domain, redeclared bindings + migrations).
- [ ] `deploy:preview` npm script + `preview-deploy.yml` (`workflow_dispatch`, deploys the chosen branch).
- [ ] Create the preview D1 + apply migrations (account-side).
- [ ] Register the preview OAuth callback on the GitHub App.
- [ ] Set preview secrets + `APP_URL`.
- [ ] Deploy `flue-agent` to preview; confirm login + the Flue echo work on the live URL.

## Open questions

- Reuse the prod GitHub App (add the preview callback) vs. a dedicated preview App? Reuse is simpler; separate isolates preview installs. Start by reusing.
- Manual dispatch vs. auto-deploy the active feature branch on push. Start manual.
- Preview D1 seeding — start empty (log in fresh) or copy prod? Start empty.
