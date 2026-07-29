import type { AppEnv } from '~/env'

/**
 * The model we run for plan authoring, as an AI Gateway provider-routing id
 * (`<provider>/<model>`). Opus-tier quality; 1M context.
 */
export const PLAN_MODEL = 'anthropic/claude-opus-4.7'

export class AIConfigError extends Error {
  constructor() {
    super('AI Gateway is not configured for this deployment.')
    this.name = 'AIConfigError'
  }
}

function assertConfigured(env: AppEnv): void {
  if (!env.AI || !env.CF_AI_GATEWAY_ID) throw new AIConfigError()
}

/** Minimal shape of an Anthropic tool definition the model answers through. */
export interface AiTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** The Anthropic-native content blocks we read back (gateway passthrough). */
interface TextBlock {
  type: 'text'
  text: string
}
interface ToolUseBlock {
  type: 'tool_use'
  name: string
  input: unknown
}
type ContentBlock = TextBlock | ToolUseBlock | { type: string }
interface MessageResponse {
  content?: ContentBlock[]
}

/**
 * Call Anthropic through the Workers AI binding, routed via our AI Gateway.
 *
 * The binding authenticates as the Worker's own account and Unified Billing
 * covers the spend — so there's no Anthropic key and no `cf-aig-authorization`
 * token in this app at all. Provider routing is a passthrough, so `input` and
 * the response are Anthropic's native Messages shapes.
 *
 * `env.AI.run` is typed against the `@cf/*` model catalog and a provider-routing
 * id ("anthropic/…") isn't in it, so we call through a narrow local signature —
 * a boundary cast at the untyped edge, not a suppressed error.
 */
function runMessages(
  env: AppEnv,
  input: Record<string, unknown>,
): Promise<MessageResponse> {
  // Call `.run` as a METHOD on the binding — not a detached reference. The
  // binding's internal run() does `this.#options = options` on its first line,
  // so a bare `run()` (losing `this`) throws "Cannot set properties of undefined".
  const ai = env.AI as unknown as {
    run(
      model: string,
      input: Record<string, unknown>,
      options: { gateway: { id: string } },
    ): Promise<MessageResponse>
  }
  return ai.run(PLAN_MODEL, input, { gateway: { id: env.CF_AI_GATEWAY_ID } })
}

/**
 * Run a single-shot completion and return the concatenated text. The input is
 * the provider-routing Messages schema (`system` + `messages` + `max_tokens`);
 * the response is Anthropic-native, so we read its `text` content blocks.
 * `max_tokens` stays under the non-streaming timeout ceiling — plans are a few
 * thousand tokens at most.
 */
export async function completeText(
  env: AppEnv,
  params: { system: string; prompt: string; maxTokens?: number },
): Promise<string> {
  assertConfigured(env)
  const res = await runMessages(env, {
    max_tokens: params.maxTokens ?? 16000,
    system: params.system,
    messages: [{ role: 'user', content: params.prompt }],
  })
  return (res.content ?? [])
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

/**
 * Run a single-shot completion that MUST answer through a tool call, and return
 * the tool's validated input. Forcing a specific tool guarantees a structured
 * shape (no brittle prose-parsing) — used where we need more than a body back,
 * e.g. a new plan's title *and* body. Extended thinking is left off: the API
 * disallows forcing a specific tool while thinking is enabled, and these are
 * short authoring calls that don't need it.
 */
export async function completeStructured<T>(
  env: AppEnv,
  params: {
    system: string
    prompt: string
    tool: AiTool
    maxTokens?: number
  },
): Promise<T> {
  assertConfigured(env)
  const res = await runMessages(env, {
    max_tokens: params.maxTokens ?? 16000,
    system: params.system,
    tools: [params.tool],
    tool_choice: { type: 'tool', name: params.tool.name },
    messages: [{ role: 'user', content: params.prompt }],
  })
  // tool_choice forces our one tool, so the first tool_use block is it.
  const block = (res.content ?? []).find((b) => b.type === 'tool_use') as
    | ToolUseBlock
    | undefined
  if (!block)
    throw new Error('Model did not return the expected structured output')
  return block.input as T
}
