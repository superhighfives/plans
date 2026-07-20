import { drizzle } from 'drizzle-orm/d1'
import { getEnv } from '~/env'
import * as schema from './schema'

/**
 * Build a Drizzle client bound to the request's D1 database.
 *
 * Call inside a per-request context only (server function / server route),
 * never at module scope — the binding is injected per request on Workers.
 */
export function getDb() {
  return drizzle(getEnv().DB, { schema })
}

export type Db = ReturnType<typeof getDb>
export { schema }
