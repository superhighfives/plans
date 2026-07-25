import { PLAN_STATE_DEFS, type PlanState } from '~/lib/plans/states'

function stateDef(state: PlanState) {
  const def = PLAN_STATE_DEFS.find((s) => s.id === state)
  if (!def) throw new Error(`Unknown plan state: ${state}`)
  return def
}

const SYSTEM = `You are a meticulous engineering planner maintaining a repository's implementation specs.

You rewrite a plan's markdown BODY when it moves between lifecycle states (backlog → ready → in-progress → done). Rules:
- Output ONLY the new markdown body. No frontmatter (no leading --- block), no code fence around the whole thing, no preamble, no closing commentary.
- Preserve the author's intent, decisions, and any concrete details already written. Never invent facts (APIs, file names, numbers) that aren't grounded in the existing plan or the provided context.
- Keep it tight and skimmable: headings, short paragraphs, checklists for tasks. Match the tone of a well-run plans/ directory.
- If information is genuinely missing, leave a clearly-marked open question rather than fabricating an answer.`

/** Per-transition guidance. Directionality matters: forward = elaborate, backward = condense. */
function transitionGuidance(from: PlanState, to: PlanState): string {
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
      return `Adjust the plan to suit its new state — "${stateDef(to).label}: ${stateDef(to).description}". Moving backward means condensing toward that state's level of detail rather than adding to it. Preserve the author's decisions; don't discard real content.`
  }
}

/**
 * Build the prompt to rewrite a plan's body for a state transition. The server
 * re-attaches and normalizes frontmatter (status + updated) afterward, so the
 * model only ever touches the body.
 */
export function buildMovePrompt(opts: {
  title: string
  fromState: PlanState
  toState: PlanState
  body: string
  /** Optional extra context the user typed alongside the move. */
  context?: string
}): { system: string; prompt: string } {
  const { title, fromState, toState, body, context } = opts
  const prompt = [
    `Plan title: ${title}`,
    `Moving from "${stateDef(fromState).label}" to "${stateDef(toState).label}".`,
    '',
    transitionGuidance(fromState, toState),
    '',
    context?.trim()
      ? `Extra context from the author (weave it in where relevant):\n${context.trim()}`
      : null,
    '',
    'Current plan body:',
    '"""',
    body,
    '"""',
    '',
    'Return the rewritten body only.',
  ]
    .filter((line) => line !== null)
    .join('\n')
  return { system: SYSTEM, prompt }
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
