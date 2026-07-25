import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBase64 } from '~/lib/crypto'
import { GitHubError } from './client'
import { fetchContentFile } from './plans'

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchContentFile', () => {
  it('returns null when the path does not exist (404)', async () => {
    // GitHub answers a missing Contents path with 404 — the destination-exists
    // guard depends on this resolving to null rather than throwing.
    mockFetch(404, { message: 'Not Found' })
    const result = await fetchContentFile(
      'tok',
      'me',
      'repo',
      'plans/ready/x.md',
      'main',
    )
    expect(result).toBeNull()
  })

  it('decodes a base64 file into text + sha on success', async () => {
    mockFetch(200, {
      type: 'file',
      encoding: 'base64',
      content: toBase64(new TextEncoder().encode('# Plan')),
      sha: 'blob123',
    })
    const result = await fetchContentFile(
      'tok',
      'me',
      'repo',
      'plans/ready/x.md',
      'main',
    )
    expect(result).toEqual({ sha: 'blob123', text: '# Plan' })
  })

  it('returns null for a path that resolves to a directory', async () => {
    mockFetch(200, [{ type: 'file', name: 'a.md' }])
    const result = await fetchContentFile(
      'tok',
      'me',
      'repo',
      'plans/ready',
      'main',
    )
    expect(result).toBeNull()
  })

  it('propagates non-404 errors (e.g. 500)', async () => {
    mockFetch(500, { message: 'boom' })
    const err = await fetchContentFile(
      'tok',
      'me',
      'repo',
      'plans/ready/x.md',
      'main',
    ).catch((e) => e)
    expect(err).toBeInstanceOf(GitHubError)
    expect(err.status).toBe(500)
  })
})
