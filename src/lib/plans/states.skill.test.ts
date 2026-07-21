import { describe, expect, it } from 'vitest'
// Vite raw import (no node:fs) — the skill lives in this repo at
// skills/plans/SKILL.md.
import skill from '../../../skills/plans/SKILL.md?raw'
import { PLAN_STATE_DEFS } from './states'

/**
 * The `plans` skill (skills/plans/SKILL.md) documents the plan lifecycle
 * in prose — an installed copy can't import states.ts, so the two can drift.
 * This test keeps the skill's canonical declarations pinned to PLAN_STATE_DEFS
 * so any change to one fails until the other is updated to match.
 */

describe('plans skill stays in sync with PLAN_STATE_DEFS', () => {
  it('documents the lifecycle in board order', () => {
    const sequence = PLAN_STATE_DEFS.map((s) => s.id).join(' → ')
    expect(skill).toContain(sequence)
  })

  it('documents the frontmatter status enum', () => {
    const statuses = PLAN_STATE_DEFS.map((s) => s.status).join(' | ')
    expect(skill).toContain(statuses)
  })

  it('mentions every state id as a subdirectory', () => {
    for (const { id } of PLAN_STATE_DEFS) {
      expect(skill).toContain(`${id}/`)
    }
  })
})
