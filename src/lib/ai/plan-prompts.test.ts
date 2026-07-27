import { describe, expect, it } from 'vitest'
import {
  buildMovePrompt,
  buildNewBacklogPrompt,
  findOpenQuestions,
  NEW_BACKLOG_TOOL,
} from './plan-prompts'

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
})

describe('buildMovePrompt', () => {
  it('embeds the body, transition, and optional context', () => {
    const { system, prompt } = buildMovePrompt({
      title: 'My Plan',
      fromState: 'backlog',
      toState: 'ready',
      body: 'A rough idea about caching.',
      context: 'Use D1 for storage.',
    })
    expect(system).toContain('ONLY the new markdown body')
    expect(prompt).toContain('My Plan')
    expect(prompt).toContain('A rough idea about caching.')
    expect(prompt).toContain('Use D1 for storage.')
    // backlog → ready promotes into a full spec.
    expect(prompt).toContain('## Tasks')
  })

  it('omits the context section when none is given', () => {
    const { prompt } = buildMovePrompt({
      title: 'P',
      fromState: 'in-progress',
      toState: 'done',
      body: 'body',
    })
    expect(prompt).not.toContain('Extra context from the author')
    expect(prompt).toContain('What was built')
  })
})

describe('buildNewBacklogPrompt', () => {
  it('embeds the idea and keeps it a backlog-stage draft', () => {
    const { system, prompt } = buildNewBacklogPrompt({
      idea: '  A way to bulk-archive old plans.  ',
    })
    // Backlog stage is rough, not a full spec.
    expect(system).toContain('BACKLOG-stage')
    expect(system).toContain('NOT a finished spec')
    expect(system).toContain('Open questions')
    // The idea is embedded, trimmed.
    expect(prompt).toContain('A way to bulk-archive old plans.')
    expect(prompt).toContain('emit_backlog_item')
  })

  it('exposes a tool schema requiring title and body', () => {
    expect(NEW_BACKLOG_TOOL.name).toBe('emit_backlog_item')
    expect(NEW_BACKLOG_TOOL.input_schema.required).toEqual(['title', 'body'])
  })
})
