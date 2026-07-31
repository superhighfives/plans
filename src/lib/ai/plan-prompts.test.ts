import { describe, expect, it } from 'vitest'
import {
  ASK_USER_TOOL,
  buildConversationalBacklogPrompt,
  buildConversationalMovePrompt,
  findOpenQuestions,
  NEW_BACKLOG_TOOL,
  PROPOSE_MOVE_TOOL,
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

  it('does not flag an "Open questions" section heading itself', () => {
    // The heading names a section; only real items under it should count.
    const body = ['## Open questions', '', 'None — all resolved.'].join('\n')
    expect(findOpenQuestions(body)).toEqual([])
  })
})

describe('PROPOSE_MOVE_TOOL', () => {
  it('exposes a tool schema requiring a body', () => {
    expect(PROPOSE_MOVE_TOOL.name).toBe('propose_move')
    expect(PROPOSE_MOVE_TOOL.input_schema.required).toEqual(['body'])
  })
})

describe('buildConversationalMovePrompt', () => {
  it('embeds the transition guidance, body, and both tool names', () => {
    const { system, prompt } = buildConversationalMovePrompt({
      title: 'My Plan',
      fromState: 'backlog',
      toState: 'ready',
      body: 'A rough idea about caching.',
      context: 'Use D1 for storage.',
      codebaseContext: [],
    })
    expect(system).toContain('ask_user')
    expect(system).toContain('propose_move')
    expect(system).toContain('never reply in plain text')
    expect(prompt).toContain('My Plan')
    expect(prompt).toContain('A rough idea about caching.')
    expect(prompt).toContain('Use D1 for storage.')
    // backlog → ready promotes into a full spec.
    expect(prompt).toContain('## Tasks')
    expect(prompt).not.toContain('codebase context')
  })

  it('folds curated codebase files into the prompt when given', () => {
    const { prompt } = buildConversationalMovePrompt({
      title: 'My Plan',
      fromState: 'ready',
      toState: 'in-progress',
      body: 'body',
      codebaseContext: [{ path: 'package.json', text: '{"name":"demo"}' }],
    })
    expect(prompt).toContain('codebase context')
    expect(prompt).toContain('### package.json')
    expect(prompt).toContain('{"name":"demo"}')
  })
})

describe('NEW_BACKLOG_TOOL', () => {
  it('exposes a tool schema requiring title and body', () => {
    expect(NEW_BACKLOG_TOOL.name).toBe('emit_backlog_item')
    expect(NEW_BACKLOG_TOOL.input_schema.required).toEqual(['title', 'body'])
  })
})

describe('ASK_USER_TOOL', () => {
  it('exposes a tool schema requiring a question', () => {
    expect(ASK_USER_TOOL.name).toBe('ask_user')
    expect(ASK_USER_TOOL.input_schema.required).toEqual(['question'])
  })
})

describe('buildConversationalBacklogPrompt', () => {
  it('embeds the idea, both tool names, and instructs one-tool-per-turn', () => {
    const { system, prompt } = buildConversationalBacklogPrompt({
      idea: 'A way to bulk-archive old plans.',
      context: [],
    })
    expect(system).toContain('BACKLOG-stage')
    expect(system).toContain('ask_user')
    expect(system).toContain('emit_backlog_item')
    expect(system).toContain('never reply in plain text')
    expect(prompt).toContain('A way to bulk-archive old plans.')
    expect(prompt).not.toContain('codebase context')
  })

  it('folds curated codebase files into the prompt when given', () => {
    const { prompt } = buildConversationalBacklogPrompt({
      idea: 'Add a test framework.',
      context: [{ path: 'package.json', text: '{"name":"demo"}' }],
    })
    expect(prompt).toContain('codebase context')
    expect(prompt).toContain('### package.json')
    expect(prompt).toContain('{"name":"demo"}')
  })
})
