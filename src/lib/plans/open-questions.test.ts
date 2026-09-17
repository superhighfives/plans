import { describe, expect, it } from 'vitest'
import { findOpenQuestions } from './open-questions'

describe('findOpenQuestions', () => {
  it('flags open questions, TBD/TODO/FIXME, and ??? markers', () => {
    const body = [
      '# Plan',
      'Solid paragraph with no issues.',
      '- Open question: which datastore?',
      '- TODO: wire up auth',
      'What about rate limits???',
      'This has a single question mark? Fine.',
    ].join('\n')
    const found = findOpenQuestions(body)
    expect(found).toHaveLength(3)
    expect(found[0]).toContain('which datastore')
    expect(found).toContain('TODO: wire up auth')
    expect(found.some((f) => f.includes('rate limits'))).toBe(true)
  })

  it('returns nothing for a clean plan', () => {
    expect(findOpenQuestions('# Plan\n\nAll settled. Ship it.')).toEqual([])
  })

  it('does not flag an "Open questions" section heading itself', () => {
    // The heading names a section; only real items under it should count.
    const body = ['## Open questions', '', 'None — all resolved.'].join('\n')
    expect(findOpenQuestions(body)).toEqual([])
  })
})
