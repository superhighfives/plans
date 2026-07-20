import { env as cfEnv } from 'cloudflare:workers'
import type { D1Database } from '@cloudflare/workers-types'

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
}

/** Read the typed Worker environment. Per-request only. */
export function getEnv(): AppEnv {
  return cfEnv as unknown as AppEnv
}
