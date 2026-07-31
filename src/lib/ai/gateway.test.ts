import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '~/env'
import { AIConfigError, completeToolTurn, PLAN_MODEL } from './gateway'

// The Workers AI binding is a plain object with a `run` method; mock that.
const run = vi.fn()
const env = {
  AI: { run },
  CF_AI_GATEWAY_ID: 'gw',
} as unknown as AppEnv

beforeEach(() => {
  run.mockReset()
})

const tool = {
  name: 'emit',
  description: 'd',
  input_schema: { type: 'object' as const, properties: {} },
}

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

  it('throws AIConfigError (without calling the model) when unconfigured', async () => {
    await expect(
      completeToolTurn({ ...env, CF_AI_GATEWAY_ID: '' } as AppEnv, {
        system: 's',
        messages: [{ role: 'user', content: 'p' }],
        tools: [tool],
      }),
    ).rejects.toBeInstanceOf(AIConfigError)
    expect(run).not.toHaveBeenCalled()
  })
})
