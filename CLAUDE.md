# CLAUDE.md

Plans — a TanStack Start app on Cloudflare Workers that reads (and, in
later phases, writes) the `plans/` directories across a user's GitHub repos.
See `README.md` for setup and `plans/ready/plans-cms.md` for the full plan.

## Commands

- `npm run dev` — local dev (Vite + Workers runtime)
- `npm run build` — production build (regenerates `src/routeTree.gen.ts`)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — unit tests (Vitest)
- `npm run db:generate` — new D1 migration from `src/db/schema.ts`
- `npm run db:migrate:local` / `:remote` — apply migrations

After changing routes or `src/db/schema.ts`, run `npm run build` (route tree)
or `npm run db:generate` (migration) respectively.

## Architecture rules (TanStack Start)

- **All code is isomorphic by default.** Server-only work (DB, secrets, GitHub)
  MUST live in `createServerFn().handler()` or a `.server.ts` helper — never in
  a route `loader` directly.
- **Auth is enforced on the server function, not the route.** Every RPC touching
  private data uses `authMiddleware` (`src/server/auth-middleware.ts`). Repo/plan
  access is re-checked against the user→installation mapping.
- **Read env per-request** via `getEnv()` (`src/env.ts`); never at module scope
  (Workers inject bindings per request).
- Server routes (OAuth, webhooks) live in `src/routes/api/**` using the `server`
  property on `createFileRoute` and return raw `Response`s.

## Layout

- `src/lib/` — pure, testable helpers (crypto, GitHub REST, frontmatter, plan rules)
- `src/server/` — `*.functions.ts` (the RPC boundary) + `*.server.ts` (DB/GitHub logic)
- `src/db/` — Drizzle schema + client
- `src/routes/` — UI routes + `api/` server routes
