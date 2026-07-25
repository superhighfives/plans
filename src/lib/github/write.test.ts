import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromBase64 } from '~/lib/crypto'
import { GitHubError } from './client'
import { createCommit, putFile } from './write'

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('putFile', () => {
  it('PUTs base64 UTF-8 content and returns the blob + commit sha', async () => {
    const spy = mockFetchOnce(200, {
      content: { sha: 'newblob' },
      commit: { sha: 'newcommit' },
    })

    const result = await putFile('tok', 'me', 'repo', 'plans/ready/foo.md', {
      content: 'héllo — plan',
      message: 'plans: update Foo',
      sha: 'baseblob',
      branch: 'main',
    })

    expect(result).toEqual({ blobSha: 'newblob', commitSha: 'newcommit' })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/repos/me/repo/contents/plans/ready/foo.md')
    expect(init.method).toBe('PUT')
    const sent = JSON.parse(init.body as string)
    expect(sent.sha).toBe('baseblob')
    expect(sent.branch).toBe('main')
    // Content is base64 of the UTF-8 bytes, not the raw string.
    const decoded = new TextDecoder().decode(fromBase64(sent.content))
    expect(decoded).toBe('héllo — plan')
  })

  it('omits sha when creating a new file', async () => {
    const spy = mockFetchOnce(201, {
      content: { sha: 'blob' },
      commit: { sha: 'commit' },
    })

    await putFile('tok', 'me', 'repo', 'plans/backlog/new.md', {
      content: 'x',
      message: 'plans: create',
    })

    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const sent = JSON.parse(init.body as string)
    expect('sha' in sent).toBe(false)
  })

  it('surfaces a stale-sha conflict as a GitHubError(409)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'does not match' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const err = await putFile('tok', 'me', 'repo', 'plans/ready/foo.md', {
      content: 'x',
      message: 'm',
      sha: 'stale',
    }).catch((e) => e)

    expect(err).toBeInstanceOf(GitHubError)
    expect(err.status).toBe(409)
  })
})

describe('createCommit', () => {
  it('walks ref → commit → tree → commit → ref, deleting old and writing new', async () => {
    const bodies: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(init.body as string) : undefined
        bodies.push({ url, method, body })
        const json = (v: unknown) =>
          new Response(JSON.stringify(v), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        if (url.includes('/git/ref/heads/'))
          return json({ object: { sha: 'HEAD' } })
        if (url.includes('/git/commits/HEAD'))
          return json({ sha: 'HEAD', tree: { sha: 'BASETREE' } })
        if (url.endsWith('/git/trees')) return json({ sha: 'NEWTREE' })
        if (url.endsWith('/git/commits')) return json({ sha: 'NEWCOMMIT' })
        if (url.includes('/git/refs/heads/')) return json({})
        throw new Error(`unexpected url ${url}`)
      },
    )

    const result = await createCommit('tok', 'me', 'repo', 'main', {
      message: 'plans: move Foo to Ready',
      changes: [
        { path: 'plans/backlog/foo.md', content: null },
        { path: 'plans/ready/foo.md', content: 'new file' },
      ],
    })

    expect(result).toEqual({ commitSha: 'NEWCOMMIT' })

    // The tree POST carries base_tree and both the delete (sha:null) and the write.
    const treeCall = bodies.find((b) => b.url.endsWith('/git/trees'))
    const tree = treeCall?.body as { base_tree: string; tree: unknown[] }
    expect(tree.base_tree).toBe('BASETREE')
    expect(tree.tree).toContainEqual({
      path: 'plans/backlog/foo.md',
      mode: '100644',
      type: 'blob',
      sha: null,
    })
    expect(tree.tree).toContainEqual({
      path: 'plans/ready/foo.md',
      mode: '100644',
      type: 'blob',
      content: 'new file',
    })

    // The commit parents the prior HEAD, and the ref update is non-forced.
    const commitCall = bodies.find(
      (b) => b.url.endsWith('/git/commits') && b.method === 'POST',
    )
    expect(
      (commitCall?.body as { parents: string[] } | undefined)?.parents,
    ).toEqual(['HEAD'])
    const refCall = bodies.find(
      (b) => b.url.includes('/git/refs/heads/') && b.method === 'PATCH',
    )
    expect(refCall?.body).toEqual({ sha: 'NEWCOMMIT', force: false })
  })
})
