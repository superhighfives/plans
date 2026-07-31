/**
 * Minimal ambient declaration for the Cloudflare Workers `cloudflare:workers`
 * module. We keep `env` deliberately loose (`Record<string, unknown>`) and
 * cast to the typed {@link AppEnv} in `src/env.ts`. This means typecheck/CI
 * work without running `wrangler types` first. If you do run `wrangler
 * types`, its generated `worker-configuration.d.ts` lives at the repo root
 * and is excluded from the TypeScript program (see tsconfig `include`), so
 * the two never conflict.
 *
 * `@cloudflare/workers-types` also declares this module (with the full,
 * accurate types), but its declaration lives inside a *non-exported*
 * namespace re-exported via `export =` — TypeScript can't merge that with a
 * plain named-export declaration for the same module specifier, and this
 * file's simpler form wins. So `WorkflowEntrypoint`/`WorkflowEvent`/
 * `WorkflowStep`/`DurableObject` (used by `~/workflows/verify-plan-move` and,
 * transitively, `@cloudflare/sandbox`'s `Sandbox` class) need declaring here
 * too, deliberately narrowed to the surface this app actually calls.
 *
 * `DurableObject`'s `__DURABLE_OBJECT_BRAND` matches the real package's brand
 * property by name (a plain string key, not a `unique symbol`) so classes
 * extending it — `@cloudflare/containers`' `Container`, and in turn
 * `@cloudflare/sandbox`'s `Sandbox` — still structurally satisfy
 * `DurableObjectNamespace<T>`'s branded-type constraint.
 */
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>

  export abstract class DurableObject<Env = unknown> {
    protected ctx: unknown
    protected env: Env
    constructor(ctx: unknown, env: Env)
    readonly __DURABLE_OBJECT_BRAND: never
  }

  export type WorkflowEvent<T> = {
    payload: Readonly<T>
    timestamp: Date
    instanceId: string
  }

  export type WorkflowStepConfig = {
    retries?: {
      limit: number
      delay: string | number
      backoff?: 'constant' | 'linear' | 'exponential'
    }
    timeout?: string | number
  }

  export abstract class WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>
    do<T>(
      name: string,
      config: WorkflowStepConfig,
      callback: () => Promise<T>,
    ): Promise<T>
  }

  export abstract class WorkflowEntrypoint<Env = unknown, T = unknown> {
    protected ctx: unknown
    protected env: Env
    constructor(ctx: unknown, env: Env)
    run(event: Readonly<WorkflowEvent<T>>, step: WorkflowStep): Promise<unknown>
  }
}
