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

import { AIConfigError, completeText } from './gateway'

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
