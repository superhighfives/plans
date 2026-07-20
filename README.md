# Plans

A multi-tenant web app on Cloudflare that reads the `plans/` directories across
your GitHub repos (the ones that use the [`planning`](plans/ready/planning-cms.md)
skill) and lets you browse them by state — **backlog, ready, in-progress, done** —
in one place. GitHub is the source of truth; the app only ever reads and (in
later phases) writes plans through the GitHub API.

This repo currently implements **Phase 0 (foundations)** and **Phase 1 (the
read-only reader)**. Editing, AI moves, and Flue chat are later phases — see the
[plan](plans/ready/planning-cms.md).

## What works today

- **Sign in with GitHub** (GitHub App user-OAuth), signed HttpOnly session cookies.
- **Installation linking** — at login the app snapshots which App installations
  you can access and stores the user→installation mapping in D1.
- **Automatic repo discovery** — scans each installation's repos for a top-level
  `plans/` folder (Git Trees API), caching results in D1.
- **Dashboard** — installations, and under each, the repos that have plans.
- **Repo view** — the four states as lists, populated from the plans.
- **Plan view** — rendered markdown body + parsed frontmatter (title, status, dates).
- **Freshness** — incremental cache keyed by git blob sha, a manual "Rescan"/
  "Refresh", and `push` / `installation` webhook handling.

Only top-level `plans/<state>/*.md` files with valid frontmatter (a non-empty
`title`) are recognized; anything else is silently skipped ("detect and skip").

## Stack

- **TanStack Start** (React 19) on **Cloudflare Workers** — server functions are
  the API boundary; tokens never reach the browser.
- **Cloudflare D1** (SQLite) + **Drizzle** for app state and caches.
- **WebCrypto** for the App JWT (RS256), installation-token encryption
  (AES-256-GCM), and cookie signing (HMAC).

## Architecture

```
Browser (TanStack Start / React)
      │  route loaders → server functions (RPC)
      ▼
Cloudflare Worker
      ├── GitHub App      → installation tokens → repo contents (read)
      ├── D1 (Drizzle)    → users, installations, repos, plan cache, audit
      └── WebCrypto       → App JWT, token encryption, cookie signing
```

Source of truth is GitHub. D1 is a cache, rebuilt on demand and validated
against git blob shas; `push` webhooks evict stale entries.

### Project layout

```
src/
  env.ts                 Typed Worker bindings/secrets (per-request only)
  router.tsx             Router factory
  db/                    Drizzle schema + client
  lib/
    crypto.ts            WebCrypto: base64(url), HMAC, AES-GCM, ids
    github/              App JWT, REST client, installation tokens, OAuth, tree/blob reads
    plans/               Frontmatter parser, state/path rules, shared types
  server/                Server functions (RPC) + server-only helpers
    session.ts           Signed cookie sessions + OAuth state
    *.functions.ts       The RPC boundary (auth-guarded)
    *.server.ts          DB/GitHub logic
  routes/
    __root.tsx           Document shell + header
    index.tsx            Dashboard / landing
    repos/$owner/$repo/  Repo view + plan view
    api/                 OAuth login/callback, logout, GitHub webhook (server routes)
migrations/              D1 SQL migrations (drizzle-kit)
```

## Setup

### 1. Register a GitHub App

Create one App (Settings → Developer settings → GitHub Apps → New):

- **Callback URL:** `https://<your-domain>/api/auth/github/callback`
  (and `http://localhost:5173/api/auth/github/callback` for local dev).
- **Webhook URL:** `https://<your-domain>/api/webhooks/github`, with a **webhook secret**.
- **Permissions:** Repository **Contents: Read-only**, **Metadata: Read-only**.
  (Contents becomes read-write in Phase 2.)
- **Subscribe to events:** `Push`, `Installation`, `Installation repositories`.
- Enable **"Request user authorization (OAuth) during installation"** /
  generate a client secret so user login works.
- Generate a **private key** (downloads a `.pem`).

Then **Install** the App on your account or an org.

### 2. Create the D1 database

```bash
npx wrangler d1 create plans
# Copy the printed database_id into wrangler.jsonc (replace REPLACE_WITH_D1_DATABASE_ID)
npm run db:migrate:remote   # apply migrations to the remote D1
```

### 3. Configure secrets

Local dev: copy `.dev.vars.example` to `.dev.vars` and fill it in.
Production: set each as a Worker secret:

```bash
for s in GITHUB_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET \
         GITHUB_APP_PRIVATE_KEY GITHUB_WEBHOOK_SECRET SESSION_SECRET \
         TOKEN_ENCRYPTION_KEY APP_URL; do npx wrangler secret put "$s"; done
```

- `SESSION_SECRET` — `openssl rand -base64 48`
- `TOKEN_ENCRYPTION_KEY` — `openssl rand -base64 32` (must decode to 32 bytes)
- `GITHUB_APP_PRIVATE_KEY` — paste the full `.pem` (PKCS#1 or PKCS#8 both work)
- `APP_URL` — the public origin, no trailing slash (e.g. `https://plans.example.com`)

### 4. Run / deploy

```bash
npm install
npm run db:migrate:local   # apply migrations to local D1
npm run dev                # http://localhost:5173
# ...
npm run deploy             # build + wrangler deploy
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Local dev server (Vite + Workers runtime) |
| `npm run build` | Production build (also regenerates the route tree) |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (frontmatter, plan paths, crypto) |
| `npm run db:generate` | Generate a D1 migration from the schema |
| `npm run db:migrate:local` / `:remote` | Apply migrations |

## Security notes

- Every server function that touches private data runs `authMiddleware`; the
  RPC endpoint — not the route — is the auth boundary.
- Repo/plan access is re-checked against the user→installation mapping on every
  request, so one tenant can't read another's repos by guessing owner/name.
- Installation tokens are cached **encrypted** (AES-256-GCM) in D1.
- Session and OAuth-state cookies are HttpOnly, SameSite=Lax, and use the
  `__Host-` prefix + Secure in production; OAuth uses a signed `state` cookie
  (GitHub OAuth doesn't support PKCE).
- The webhook verifies `X-Hub-Signature-256` before trusting any payload.

## Deviations from the plan (v1 scope)

These are deliberate simplifications for the first shippable slice; each has a
clear upgrade path noted in the code:

- **Discovery runs inline, not on Queues.** The plan calls for Cloudflare Queues
  fan-out. v1 runs the scan on-demand (first dashboard load + manual "Rescan"),
  with bounded concurrency. `scanInstallation`/`scanRepo` are factored so they
  can be lifted into a queue consumer without change.
- **Sessions are stateless signed cookies** (no server-side session table). The
  layer is intentionally thin so an identity provider (or DB sessions) can be
  slotted in later.
- **The user OAuth token is not persisted.** It's used only during the callback
  to identify the user and snapshot their installations. Installing the App
  somewhere new later is picked up by signing in again.
- **Discovery does a lightweight presence check** (a `plans/<state>/*.md` file
  exists); full frontmatter validation happens when a repo/plan is opened, and
  invalid plans are skipped there.

## License

Private / unreleased.
