import { type PlanState, planStateDef } from '~/lib/plans/states'
import type { AiTool } from './gateway'

export const MOVE_SYSTEM = `You are a meticulous engineering planner maintaining a repository's implementation specs.

You rewrite a plan's markdown BODY when it moves between lifecycle states (backlog → ready → in-progress → done). Rules:
- Output ONLY the new markdown body. No frontmatter (no leading --- block), no code fence around the whole thing, no preamble, no closing commentary.
- Preserve the author's intent, decisions, and any concrete details already written. Never invent facts (APIs, file names, numbers) that aren't grounded in the existing plan or the provided context.
- Keep it tight and skimmable: headings, short paragraphs, checklists for tasks. Match the tone of a well-run plans/ directory.
- If information is genuinely missing, leave a clearly-marked open question rather than fabricating an answer.`

/** Per-transition guidance. Directionality matters: forward = elaborate, backward = condense. */
export function transitionGuidance(from: PlanState, to: PlanState): string {
  const key = `${from}->${to}`
  switch (key) {
    case 'backlog->ready':
      return `Promote this rough idea into a full, ready-to-implement spec. Expand it into these sections (omit one only if truly not applicable):

## Goal
One paragraph: what this delivers and why.

## Context
The relevant background, constraints, and any prior decisions.

## Approach
How it will be built — architecture, key components, trade-offs.

## Tasks
- [ ] A checklist an implementer (human or agent) could follow.

Flesh out what the idea implies, but flag anything you genuinely can't determine as an open question rather than guessing.`
    case 'ready->in-progress':
      return `This spec is now being actively implemented. Keep the spec intact. Add (or update) a short "## Progress" section near the top for decisions and status as work happens — seed it with a first entry noting work has started and anything the provided context establishes. Do not rewrite the whole plan.`
    case 'in-progress->done':
      return `This work has shipped. Keep the historical plan, and add an accurate record of what was actually built at the top:

## Overview
What shipped, in a few sentences.

## What was built
The concrete changes — components, files, decisions — grounded in the plan and the provided context. Do not invent details.

If the plan's original tasks are now complete, mark them done.`
    default:
      // Backward moves (e.g. ready → backlog) and any less common transition.
      return `Adjust the plan to suit its new state — "${planStateDef(to).label}: ${planStateDef(to).description}". Moving backward means condensing toward that state's level of detail rather than adding to it. Preserve the author's decisions; don't discard real content.`
  }
}

const NEW_BACKLOG_SYSTEM = `You are a meticulous engineering planner helping seed a repository's backlog.

You turn a rough idea into a BACKLOG-stage plan — an early, unscoped note, NOT a finished spec. Fleshing it into a full spec happens later, when it's promoted to "ready". Rules:
- Propose a concise, descriptive title (a few words, sentence case) that names the work.
- Write a short markdown body: a paragraph or two capturing the idea and why it might matter, a brief bullet sketch of what it could involve, and an "## Open questions" list of what still needs deciding. Keep it rough and honest about unknowns.
- Never invent specifics (APIs, file names, numbers) that aren't implied by the idea — prefer an open question over a fabricated detail.
- The body is markdown only: no frontmatter (no leading --- block), no code fence around the whole thing, no preamble or closing commentary. Do NOT repeat the title as a heading — the plan's frontmatter already holds it.`

/** Tool the model answers through so we get a structured {title, body} back. */
export const NEW_BACKLOG_TOOL: AiTool = {
  name: 'emit_backlog_item',
  description:
    'Return the drafted backlog item: a concise title and a rough markdown body.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Concise, descriptive plan title in sentence case.',
      },
      body: {
        type: 'string',
        description:
          'Rough backlog-stage markdown body — no frontmatter, no title heading.',
      },
    },
    required: ['title', 'body'],
  },
}

/**
 * Tool Flue uses to pause a draft and ask the author one clarifying question.
 * Paired with {@link NEW_BACKLOG_TOOL} under `tool_choice: "any"` so every
 * turn is one or the other — never free text.
 */
export const ASK_USER_TOOL: AiTool = {
  name: 'ask_user',
  description:
    'Ask the author ONE clarifying question before drafting further. Use only when a genuinely ambiguous decision would change the plan — prefer drafting with an "Open questions" entry over asking anything you could reasonably infer or leave open.',
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'A single, specific question for the author.',
      },
    },
    required: ['question'],
  },
}

/**
 * Build the system + first user prompt for Flue's conversational new-backlog
 * flow: a backlog-stage framing (rough, unscoped — not a finished spec), plus
 * the repo's curated codebase context (so the draft is grounded in what's
 * actually there) and the option to ask a clarifying question via
 * {@link ASK_USER_TOOL} before committing to a draft.
 */
export function buildConversationalBacklogPrompt(opts: {
  idea: string
  context: { path: string; text: string }[]
}): { system: string; prompt: string } {
  const system = `${NEW_BACKLOG_SYSTEM}

You have two tools: \`ask_user\` to get a clarifying answer before drafting, and \`emit_backlog_item\` to submit the finished draft. Every turn, call exactly one of them — never reply in plain text. Ask at most a couple of questions total; once you have enough to write an honest, rough backlog entry (open questions in the body are fine for the rest), emit the draft.`

  const contextBlock =
    opts.context.length > 0
      ? [
          "The repo's codebase context — ground the idea in what's actually here (stack, structure, conventions):",
          ...opts.context.map(
            (f) => `### ${f.path}\n\`\`\`\n${f.text}\n\`\`\``,
          ),
        ].join('\n\n')
      : null

  const prompt = [
    contextBlock,
    'Rough idea from the author:',
    '"""',
    opts.idea.trim(),
    '"""',
    '',
    'Call ask_user if something essential is ambiguous, otherwise call emit_backlog_item now.',
  ]
    .filter((line) => line !== null)
    .join('\n\n')

  return { system, prompt }
}

/**
 * Tool Flue uses to submit the finished rewritten body for a conversational
 * plan move. Paired with {@link ASK_USER_TOOL} under `tool_choice: "any"`, the
 * same shape as the conversational backlog draft.
 */
export const PROPOSE_MOVE_TOOL: AiTool = {
  name: 'propose_move',
  description:
    "Submit the plan's rewritten markdown body for its new lifecycle state.",
  input_schema: {
    type: 'object',
    properties: {
      body: {
        type: 'string',
        description:
          'The full rewritten markdown body — no frontmatter, matching the transition guidance.',
      },
    },
    required: ['body'],
  },
}

/**
 * Build the system + first user prompt for Flue's conversational move: the
 * per-transition guidance from {@link transitionGuidance}, plus the repo's
 * curated codebase context and the option to ask a clarifying question via
 * {@link ASK_USER_TOOL} before committing to a rewrite.
 */
export function buildConversationalMovePrompt(opts: {
  title: string
  fromState: PlanState
  toState: PlanState
  body: string
  context?: string
  codebaseContext: { path: string; text: string }[]
}): { system: string; prompt: string } {
  const { title, fromState, toState, body, context, codebaseContext } = opts
  const system = `${MOVE_SYSTEM}

You have two tools: \`ask_user\` to get a clarifying answer before rewriting, and \`propose_move\` to submit the finished body. Every turn, call exactly one of them — never reply in plain text. Ask at most a couple of questions total; once you have enough to write an honest rewrite (open questions in the body are fine for the rest), propose the move.`

  const contextBlock =
    codebaseContext.length > 0
      ? [
          "The repo's codebase context — ground the rewrite in what's actually here (stack, structure, conventions):",
          ...codebaseContext.map(
            (f) => `### ${f.path}\n\`\`\`\n${f.text}\n\`\`\``,
          ),
        ].join('\n\n')
      : null

  const prompt = [
    `Plan title: ${title}`,
    `Moving from "${planStateDef(fromState).label}" to "${planStateDef(toState).label}".`,
    '',
    transitionGuidance(fromState, toState),
    '',
    contextBlock,
    context?.trim()
      ? `Extra context from the author (weave it in where relevant):\n${context.trim()}`
      : null,
    '',
    'Current plan body:',
    '"""',
    body,
    '"""',
    '',
    'Call ask_user if something essential is ambiguous, otherwise call propose_move now with the rewritten body.',
  ]
    .filter((line) => line !== null)
    .join('\n\n')

  return { system, prompt }
}

/**
 * Heuristic scan for unresolved questions — used to warn (not block) before a
 * plan is promoted to `ready`. Matches the conventions the skill's prose uses.
 */
export function findOpenQuestions(body: string): string[] {
  const found: string[] = []
  const lines = body.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // A markdown heading like "## Open questions" names a *section*; it isn't
    // itself an unresolved question. Skip it so we don't flag the heading text.
    if (line.startsWith('#')) continue
    if (
      /\bopen question/i.test(line) ||
      /\b(TBD|TODO|FIXME)\b/.test(line) ||
      /\?{2,}/.test(line)
    ) {
      found.push(line.replace(/^[-*#>\s]+/, '').slice(0, 140))
    }
  }
  return found
}
