import { describe, expect, it } from 'vitest'
import { parseAgentInstance, parseInstanceName } from './instance'

describe('parseInstanceName', () => {
  it('splits owner~repo on the first delimiter', () => {
    expect(parseInstanceName('octocat~hello-world')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
    })
    expect(parseInstanceName('me~a~b')).toEqual({ owner: 'me', repo: 'a~b' })
  })

  it('returns null when the delimiter or a side is missing', () => {
    expect(parseInstanceName('noseparator')).toBeNull()
    expect(parseInstanceName('~repo')).toBeNull()
    expect(parseInstanceName('owner~')).toBeNull()
    expect(parseInstanceName('')).toBeNull()
  })
})

describe('parseAgentInstance', () => {
  it('parses owner~repo from the instance segment', () => {
    expect(
      parseAgentInstance('/agents/flue-agent/octocat~hello-world'),
    ).toEqual({ owner: 'octocat', repo: 'hello-world' })
  })

  it('splits on the first ~ (repo names can contain more)', () => {
    // repo names allow more chars than the delimiter; owner can't contain ~.
    expect(parseAgentInstance('/agents/flue-agent/me~a~b')).toEqual({
      owner: 'me',
      repo: 'a~b',
    })
  })

  it('decodes a percent-encoded segment', () => {
    expect(parseAgentInstance('/agents/flue-agent/me~my%2Erepo')).toEqual({
      owner: 'me',
      repo: 'my.repo',
    })
  })

  it('returns null for a malformed percent-encoding (would throw)', () => {
    // A bare `%` makes decodeURIComponent throw — must not escape as a 500.
    expect(parseAgentInstance('/agents/flue-agent/me~bad%')).toBeNull()
  })

  it('returns null when the delimiter or a side is missing', () => {
    expect(parseAgentInstance('/agents/flue-agent/noseparator')).toBeNull()
    expect(parseAgentInstance('/agents/flue-agent/~repo')).toBeNull()
    expect(parseAgentInstance('/agents/flue-agent/owner~')).toBeNull()
    expect(parseAgentInstance('/agents/flue-agent/')).toBeNull()
    expect(parseAgentInstance('/agents/flue-agent')).toBeNull()
  })
})
