import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '~/env'
import {
  AIConfigError,
  completeStructured,
  completeText,
  completeToolTurn,
  PLAN_MODEL,
} from './gateway'

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
      PLAN_MODEL,
      expect.objectContaining({
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
      PLAN_MODEL,
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

const askTool = {
  name: 'ask_user',
  description: 'ask',
  input_schema: { type: 'object' as const, properties: {} },
}

describe('completeToolTurn', () => {
  it('forces one of several tools (tool_choice: any) and returns the call + raw content', async () => {
    const content = [
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'ask_user',
        input: { question: 'Which datastore?' },
      },
    ]
    run.mockResolvedValue({ content })

    const messages = [{ role: 'user' as const, content: 'go' }]
    const out = await completeToolTurn(env, {
      system: 'sys',
      messages,
      tools: [askTool, tool],
    })

    expect(out.toolCall).toEqual({
      id: 'call_1',
      name: 'ask_user',
      input: { question: 'Which datastore?' },
    })
    expect(out.content).toBe(content)
    expect(run).toHaveBeenCalledWith(
      PLAN_MODEL,
      expect.objectContaining({
        tools: [askTool, tool],
        tool_choice: { type: 'any' },
        messages,
      }),
      { gateway: { id: 'gw' } },
    )
  })

  it('throws when the model returns no tool_use block', async () => {
    run.mockResolvedValue({ content: [{ type: 'text', text: 'nope' }] })
    await expect(
      completeToolTurn(env, {
        system: 's',
        messages: [{ role: 'user', content: 'p' }],
        tools: [tool],
      }),
    ).rejects.toThrow(/tool call/)
  })
})
