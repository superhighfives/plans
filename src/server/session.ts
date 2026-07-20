import type { AppEnv } from '~/env'
import { fromBase64Url, hmacSign, hmacVerify, toBase64Url } from '~/lib/crypto'

/**
 * Stateless, signed session cookies. The cookie carries a small signed payload
 * (user id + login + issued-at); there is no server-side session table in v1.
 * The plan keeps this layer thin so an identity provider could be slotted in
 * later without a rewrite.
 */

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 days
const OAUTH_STATE_MAX_AGE_SEC = 60 * 10 // 10 minutes

export interface SessionData {
  /** App user id. */
  uid: string
  login: string
  /** Issued-at (unix seconds). */
  iat: number
}

/**
 * In production (https) we use the `__Host-` prefix, which binds the cookie to
 * the exact origin and requires Secure + Path=/. On http (local dev) browsers
 * reject Secure/`__Host-` cookies, so we drop both.
 */
function isSecure(env: AppEnv): boolean {
  return env.APP_URL.startsWith('https://')
}

function sessionCookieName(env: AppEnv): string {
  return isSecure(env) ? '__Host-plans_session' : 'plans_session'
}

function oauthCookieName(env: AppEnv): string {
  return isSecure(env) ? '__Host-plans_oauth' : 'plans_oauth'
}

function cookieAttrs(env: AppEnv, maxAge: number): string {
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`]
  if (isSecure(env)) attrs.push('Secure')
  return attrs.join('; ')
}

// --- signing --------------------------------------------------------------

async function sign(secret: string, payload: unknown): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacSign(secret, body)
  return `${body}.${sig}`
}

async function unsign<T>(secret: string, value: string): Promise<T | null> {
  const dot = value.lastIndexOf('.')
  if (dot === -1) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  if (!(await hmacVerify(secret, body, sig))) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T
  } catch {
    return null
  }
}

// --- cookie parsing -------------------------------------------------------

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

// --- session --------------------------------------------------------------

export async function buildSessionSetCookie(env: AppEnv, session: SessionData): Promise<string> {
  const value = await sign(env.SESSION_SECRET, session)
  return `${sessionCookieName(env)}=${value}; ${cookieAttrs(env, SESSION_MAX_AGE_SEC)}`
}

export function buildSessionClearCookie(env: AppEnv): string {
  return `${sessionCookieName(env)}=; ${cookieAttrs(env, 0)}`
}

export async function readSession(
  env: AppEnv,
  cookieHeader: string | null | undefined,
): Promise<SessionData | null> {
  const raw = parseCookies(cookieHeader)[sessionCookieName(env)]
  if (!raw) return null
  const data = await unsign<SessionData>(env.SESSION_SECRET, raw)
  if (!data) return null
  if (data.iat + SESSION_MAX_AGE_SEC < Math.floor(Date.now() / 1000)) return null
  return data
}

// --- oauth state ----------------------------------------------------------

export async function buildOAuthStateSetCookie(env: AppEnv, state: string): Promise<string> {
  const value = await sign(env.SESSION_SECRET, { state, iat: Math.floor(Date.now() / 1000) })
  return `${oauthCookieName(env)}=${value}; ${cookieAttrs(env, OAUTH_STATE_MAX_AGE_SEC)}`
}

export function buildOAuthStateClearCookie(env: AppEnv): string {
  return `${oauthCookieName(env)}=; ${cookieAttrs(env, 0)}`
}

export async function readOAuthState(
  env: AppEnv,
  cookieHeader: string | null | undefined,
): Promise<string | null> {
  const raw = parseCookies(cookieHeader)[oauthCookieName(env)]
  if (!raw) return null
  const data = await unsign<{ state: string; iat: number }>(env.SESSION_SECRET, raw)
  if (!data) return null
  if (data.iat + OAUTH_STATE_MAX_AGE_SEC < Math.floor(Date.now() / 1000)) return null
  return data.state
}
