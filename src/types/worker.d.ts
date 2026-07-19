/**
 * Minimal ambient declaration for the Cloudflare Workers `env` binding module.
 *
 * We keep this deliberately loose (`Record<string, unknown>`) and cast to the
 * typed {@link AppEnv} in `src/env.ts`. This means typecheck/CI work without
 * running `wrangler types` first. If you do run `wrangler types`, its generated
 * `worker-configuration.d.ts` lives at the repo root and is excluded from the
 * TypeScript program (see tsconfig `include`), so the two never conflict.
 */
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>
}
