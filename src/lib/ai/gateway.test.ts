import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '~/env'

// Mock the Anthropic SDK so no real client/network is constructed. `vi.hoisted`
// gives the factory (which is hoisted above imports) access to the spy.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { AIConfigError, completeStructured, completeText } from './gateway'

const env = {
  CF_AI_GATEWAY_ACCOUNT_ID: 'acct',
  CF_AI_GATEWAY_ID: 'gw',
  CF_AI_GATEWAY_TOKEN: 'token',
} as unknown as AppEnv

beforeEach(() => {
  createMock.mockReset()
})

describe('completeText', () => {
  it('joins text blocks, ignoring thinking blocks, and trims', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: '  Hello ' },
        { type: 'text', text: 'world  ' },
      ],
    })

    const out = await completeText(env, { system: 'sys', prompt: 'go' })

    expect(out).toBe('Hello world')
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-8',
        thinking: { type: 'adaptive' },
        system: 'sys',
        messages: [{ role: 'user', content: 'go' }],
      }),
    )
  })

  it('throws AIConfigError (without calling the model) when unconfigured', async () => {
    await expect(
      completeText({ ...env, CF_AI_GATEWAY_TOKEN: '' } as AppEnv, {
        system: 's',
        prompt: 'p',
      }),
    ).rejects.toBeInstanceOf(AIConfigError)
    expect(createMock).not.toHaveBeenCalled()
  })
})

const tool = {
  name: 'emit',
  description: 'd',
  input_schema: { type: 'object' as const, properties: {} },
}

describe('completeStructured', () => {
  it('forces the tool and returns its parsed input', async () => {
    createMock.mockResolvedValue({
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
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [tool],
        tool_choice: { type: 'tool', name: 'emit' },
      }),
    )
    // Structured calls don't enable extended thinking (incompatible with a
    // forced tool_choice).
    expect(createMock.mock.calls[0]?.[0]).not.toHaveProperty('thinking')
  })

  it('throws when the model returns no matching tool_use block', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'nope' }] })
    await expect(
      completeStructured(env, { system: 's', prompt: 'p', tool }),
    ).rejects.toThrow(/structured output/)
  })
})
