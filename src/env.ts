import { env as cfEnv } from 'cloudflare:workers'
import type { Sandbox } from '@cloudflare/sandbox'
import type {
  Ai,
  D1Database,
  DurableObjectNamespace,
  Workflow,
} from '@cloudflare/workers-types'
import type { VerifyPlanMovePayload } from '~/workflows/verify-plan-move'

/**
 * Typed view of the Worker's bindings + secrets.
 *
 * IMPORTANT: only ever read this inside a per-request context (server function
 * `.handler()`, middleware `.server()`, or a server-route handler). On
 * Cloudflare Workers, env is injected per request — module-scope reads are
 * `undefined`.
 */
export interface AppEnv {
  /** D1 database binding. */
  DB: D1Database

  /** Workers AI binding — used for Claude calls routed through the AI Gateway. */
  AI: Ai

  /** Flue conversational agent — one Durable Object instance per repo. */
  FlueAgent: DurableObjectNamespace

  /** One ephemeral container per verify-plan-move run (slice 5). */
  Sandbox: DurableObjectNamespace<Sandbox>

  /** Clones a repo, installs deps, and runs its test/build scripts before a
   * "move to done" commits — see `~/workflows/verify-plan-move`. */
  VERIFY_PLAN_MOVE_WORKFLOW: Workflow<VerifyPlanMovePayload>

  /** GitHub App numeric id. */
  GITHUB_APP_ID: string
  /** GitHub App OAuth client id (user-to-server login). */
  GITHUB_APP_CLIENT_ID: string
  /** GitHub App OAuth client secret. */
  GITHUB_APP_CLIENT_SECRET: string
  /** GitHub App private key PEM (PKCS#1 or PKCS#8). */
  GITHUB_APP_PRIVATE_KEY: string
  /** Secret configured on the App's webhook. */
  GITHUB_WEBHOOK_SECRET: string

  /** Base64 secret used to sign session + oauth-state cookies. */
  SESSION_SECRET: string
  /** Base64 32-byte AES-256-GCM key for the installation-token cache. */
  TOKEN_ENCRYPTION_KEY: string

  /** Public origin of this deployment, e.g. https://plans.example.com (no trailing slash). */
  APP_URL: string

  /**
   * The AI Gateway id (its slug) to route Claude calls through. Auth and billing
   * ride on the `AI` binding (the Worker's own account + Unified Billing), so no
   * account id, gateway token, or Anthropic API key lives in this app.
   */
  CF_AI_GATEWAY_ID: string
}

/** Read the typed Worker environment. Per-request only. */
export function getEnv(): AppEnv {
  return cfEnv as unknown as AppEnv
}
