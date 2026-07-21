import { eq } from 'drizzle-orm'
import type { Db } from '~/db'
import type { Installation } from '~/db/schema'
import { installations as installationsTable } from '~/db/schema'
import type { AppEnv } from '~/env'
import { decryptSecret, encryptSecret } from '~/lib/crypto'
import { githubPaginate, githubRequest } from './client'
import { createAppJwt } from './jwt'

/** Refresh a cached installation token when it's within this window of expiry. */
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

interface InstallationTokenResponse {
  token: string
  expires_at: string
}

/**
 * Return a valid installation access token for an installation, minting and
 * caching (encrypted) a fresh one when the cache is empty or near expiry.
 */
export async function getInstallationToken(
  db: Db,
  env: AppEnv,
  installation: Installation,
): Promise<string> {
  const cached = await readCachedToken(env, installation)
  if (cached) return cached

  // The cache check uses the caller's (possibly stale) row, so two concurrent
  // requests racing past an expired cache can both mint a token and both write
  // the row. That's intentionally tolerated: GitHub allows the extra mint and
  // last-write-wins leaves a valid token cached. If this path gets hot, re-read
  // the row (or take a lock) here before minting.
  const jwt = await createAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY)
  const res = await githubRequest<InstallationTokenResponse>(
    `/app/installations/${installation.githubInstallationId}/access_tokens`,
    { method: 'POST', token: jwt },
  )

  const expiresAt = Date.parse(res.expires_at)
  const ciphertext = await encryptSecret(env.TOKEN_ENCRYPTION_KEY, res.token)
  await db
    .update(installationsTable)
    .set({
      tokenCiphertext: ciphertext,
      tokenExpiresAt: expiresAt,
      updatedAt: Date.now(),
    })
    .where(eq(installationsTable.id, installation.id))

  return res.token
}

async function readCachedToken(
  env: AppEnv,
  installation: Installation,
): Promise<string | null> {
  if (!installation.tokenCiphertext || !installation.tokenExpiresAt) return null
  if (installation.tokenExpiresAt - Date.now() < TOKEN_REFRESH_SKEW_MS)
    return null
  try {
    return await decryptSecret(
      env.TOKEN_ENCRYPTION_KEY,
      installation.tokenCiphertext,
    )
  } catch {
    // Key rotated or corrupt cache — fall back to minting a fresh token.
    return null
  }
}

export interface InstallationRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  default_branch: string
  owner: { login: string }
}

/** List every repository the installation can access. */
export async function listInstallationRepos(
  token: string,
): Promise<InstallationRepo[]> {
  return githubPaginate<InstallationRepo>('/installation/repositories', {
    token,
    arrayKey: 'repositories',
  })
}
