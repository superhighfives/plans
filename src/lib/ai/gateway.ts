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
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}
/** A tool's result, sent back to the model as part of the next user turn. */
export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
}
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | { type: string }
interface MessageResponse {
  content?: ContentBlock[]
}

/** One turn in an ongoing tool-calling conversation (Anthropic-native shape). */
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
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

/** One turn's result from {@link completeToolTurn}. */
export interface ToolTurnResult {
  /** The raw content blocks the model returned — echo these back verbatim as
   * the next `assistant` message so the transcript stays faithful. */
  content: ContentBlock[]
  /** The tool the model chose. `tool_choice: "any"` guarantees exactly one. */
  toolCall: { id: string; name: string; input: unknown }
}

/**
 * Run one turn of a multi-tool conversation, forcing the model to answer via
 * one of `tools` every turn (never plain prose) — a Q&A agent loop without
 * parsing free text. The caller owns the transcript: pass the full message
 * history, appending the previous turn's `assistant` content (from
 * {@link ToolTurnResult.content}) and a `tool_result` user message with the
 * tool's answer before calling again.
 */
export async function completeToolTurn(
  env: AppEnv,
  params: {
    system: string
    messages: AiMessage[]
    tools: AiTool[]
    maxTokens?: number
  },
): Promise<ToolTurnResult> {
  assertConfigured(env)
  const res = await runMessages(env, {
    max_tokens: params.maxTokens ?? 4000,
    system: params.system,
    tools: params.tools,
    tool_choice: { type: 'any' },
    messages: params.messages,
  })
  const content = res.content ?? []
  const block = content.find((b) => b.type === 'tool_use') as
    | ToolUseBlock
    | undefined
  if (!block) throw new Error('Model did not return the expected tool call')
  return {
    content,
    toolCall: { id: block.id, name: block.name, input: block.input },
  }
}
