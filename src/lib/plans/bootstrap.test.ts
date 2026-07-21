import { describe, expect, it } from 'vitest'
import {
  AGENTS_BLOCK,
  AGENTS_BLOCK_END,
  AGENTS_BLOCK_START,
  PLANS_README_TEMPLATE,
  renderStartScript,
} from './bootstrap'
import { PLAN_STATE_DEFS } from './states'

const ORIGIN = 'https://plans.superhighfives.com'
const script = renderStartScript(ORIGIN)

describe('renderStartScript', () => {
  it('is a POSIX sh script with fail-fast', () => {
    expect(script.startsWith('#!/bin/sh')).toBe(true)
    expect(script).toContain('\nset -e\n')
  })

  it('pins the origin and the self-served skill URL', () => {
    expect(script).toContain(`ORIGIN='${ORIGIN}'`)
    expect(script).toContain('"$ORIGIN/start/skill"')
    expect(script).toContain('.claude/skills/plans/SKILL.md')
  })

  it('guards every step so re-runs are idempotent', () => {
    // skill / AGENTS.md / plans dir each behind an existence check
    expect(script).toContain('if [ -f .claude/skills/plans/SKILL.md ]')
    expect(script).toContain(`grep -q '${AGENTS_BLOCK_START}' AGENTS.md`)
    expect(script).toContain('if [ -d plans ]')
  })

  it('bootstraps every plan state directory', () => {
    const ids = PLAN_STATE_DEFS.map((s) => s.id).join(' ')
    expect(script).toContain(`for s in ${ids};`)
  })

  it('embeds the AGENTS block and README seed via quoted heredocs', () => {
    expect(script).toContain(AGENTS_BLOCK)
    expect(script).toContain(PLANS_README_TEMPLATE.trimEnd())
    // quoted delimiters => no shell expansion of the embedded content
    expect(script).toContain("<<'PLANS_AGENTS_BLOCK'")
    expect(script).toContain("<<'PLANS_README'")
  })
})

describe('AGENTS block', () => {
  it('is wrapped in the find/replace delimiters', () => {
    expect(AGENTS_BLOCK.startsWith(AGENTS_BLOCK_START)).toBe(true)
    expect(AGENTS_BLOCK.endsWith(AGENTS_BLOCK_END)).toBe(true)
  })
})
