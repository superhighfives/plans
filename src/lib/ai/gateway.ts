import Anthropic from '@anthropic-ai/sdk'
import type { AppEnv } from '~/env'

/** The model we run for plan authoring. Opus-tier quality; 1M context. */
export const PLAN_MODEL = 'claude-opus-4-8'

/**
 * An Anthropic client pointed at this deployment's Cloudflare AI Gateway.
 *
 * The gateway supplies the Anthropic credentials (Unified Billing or a stored
 * BYOK key) and proxies the call — so we authenticate to the *gateway* with a
 * `cf-aig-authorization` token and never hold an Anthropic key here. The SDK
 * still requires a non-empty `apiKey`, but the gateway ignores the `x-api-key`
 * it sends. Constructed per request because env is injected per request.
 */
export function anthropic(env: AppEnv): Anthropic {
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${env.CF_AI_GATEWAY_ACCOUNT_ID}/${env.CF_AI_GATEWAY_ID}/anthropic`
  return new Anthropic({
    apiKey: 'unused-gateway-supplies-credentials',
    baseURL,
    defaultHeaders: {
      'cf-aig-authorization': `Bearer ${env.CF_AI_GATEWAY_TOKEN}`,
    },
  })
}

export class AIConfigError extends Error {
  constructor() {
    super('AI Gateway is not configured for this deployment.')
    this.name = 'AIConfigError'
  }
}

function assertConfigured(env: AppEnv): void {
  if (
    !env.CF_AI_GATEWAY_ACCOUNT_ID ||
    !env.CF_AI_GATEWAY_ID ||
    !env.CF_AI_GATEWAY_TOKEN
  )
    throw new AIConfigError()
}

/**
 * Run a single-shot completion and return the concatenated text. Adaptive
 * thinking is on (Opus 4.8 runs without it unless asked); we read only the
 * `text` blocks, so any thinking blocks are ignored. `max_tokens` stays under
 * the non-streaming timeout ceiling — plans are a few thousand tokens at most.
 */
export async function completeText(
  env: AppEnv,
  params: { system: string; prompt: string; maxTokens?: number },
): Promise<string> {
  assertConfigured(env)
  const client = anthropic(env)
  const message = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: params.maxTokens ?? 16000,
    thinking: { type: 'adaptive' },
    system: params.system,
    messages: [{ role: 'user', content: params.prompt }],
  })
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}
