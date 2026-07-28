import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '~/env'
import { AIConfigError, completeStructured, completeText } from './gateway'

// The Workers AI binding is a plain object with a `run` method; mock that.
const run = vi.fn()
const env = {
  AI: { run },
  CF_AI_GATEWAY_ID: 'gw',
} as unknown as AppEnv

beforeEach(() => {
  run.mockReset()
})

describe('completeText', () => {
  it('joins text blocks, ignoring thinking blocks, and trims', async () => {
    run.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: '  Hello ' },
        { type: 'text', text: 'world  ' },
      ],
    })

    const out = await completeText(env, { system: 'sys', prompt: 'go' })

    expect(out).toBe('Hello world')
    expect(run).toHaveBeenCalledWith(
      'anthropic/claude-opus-4-8',
      expect.objectContaining({
        thinking: { type: 'adaptive' },
        system: 'sys',
        messages: [{ role: 'user', content: 'go' }],
      }),
      { gateway: { id: 'gw' } },
    )
  })

  it('throws AIConfigError (without calling the model) when unconfigured', async () => {
    await expect(
      completeText({ ...env, CF_AI_GATEWAY_ID: '' } as AppEnv, {
        system: 's',
        prompt: 'p',
      }),
    ).rejects.toBeInstanceOf(AIConfigError)
    expect(run).not.toHaveBeenCalled()
  })
})

const tool = {
  name: 'emit',
  description: 'd',
  input_schema: { type: 'object' as const, properties: {} },
}

describe('completeStructured', () => {
  it('forces the tool and returns its parsed input', async () => {
    run.mockResolvedValue({
      content: [
        { type: 'text', text: 'ignored prose' },
        { type: 'tool_use', name: 'emit', input: { title: 'T', body: 'B' } },
      ],
    })

    const out = await completeStructured<{ title: string; body: string }>(env, {
      system: 'sys',
      prompt: 'go',
      tool,
    })

    expect(out).toEqual({ title: 'T', body: 'B' })
    expect(run).toHaveBeenCalledWith(
      'anthropic/claude-opus-4-8',
      expect.objectContaining({
        tools: [tool],
        tool_choice: { type: 'tool', name: 'emit' },
      }),
      { gateway: { id: 'gw' } },
    )
    // Structured calls don't enable extended thinking (incompatible with a
    // forced tool_choice).
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty('thinking')
  })

  it('throws when the model returns no tool_use block', async () => {
    run.mockResolvedValue({ content: [{ type: 'text', text: 'nope' }] })
    await expect(
      completeStructured(env, { system: 's', prompt: 'p', tool }),
    ).rejects.toThrow(/structured output/)
  })
})
