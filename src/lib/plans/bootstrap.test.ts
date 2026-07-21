import { describe, expect, it } from 'vitest'
import {
  AGENT_SKILL_DIRS,
  AGENTS_BLOCK,
  AGENTS_BLOCK_END,
  AGENTS_BLOCK_START,
  PLANS_README_TEMPLATE,
  renderStartPage,
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
  })

  it('installs the skill into every agent dir', () => {
    expect(script).toContain(`SKILL_DIRS="${AGENT_SKILL_DIRS.join(' ')}"`)
    // both the canonical .agents dir and Claude Code's dir
    expect(AGENT_SKILL_DIRS).toContain('.agents/skills/plans')
    expect(AGENT_SKILL_DIRS).toContain('.claude/skills/plans')
  })

  it('has an update verb that refreshes and exits early', () => {
    expect(script).toContain('if [ "$CMD" = "update" ]')
    expect(script).toContain('refreshed')
    expect(script).toContain('sh -s -- update')
  })

  it('guards every bootstrap step so re-runs are idempotent', () => {
    expect(script).toContain('if [ -f "$d/SKILL.md" ]')
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
    expect(script).toContain("<<'PLANS_AGENTS_BLOCK'")
    expect(script).toContain("<<'PLANS_README'")
  })
})

describe('AGENTS block', () => {
  it('is wrapped in the find/replace delimiters', () => {
    expect(AGENTS_BLOCK.startsWith(AGENTS_BLOCK_START)).toBe(true)
    expect(AGENTS_BLOCK.endsWith(AGENTS_BLOCK_END)).toBe(true)
  })

  it('points at the canonical .agents skill path', () => {
    expect(AGENTS_BLOCK).toContain('.agents/skills/plans/SKILL.md')
  })
})

describe('renderStartPage', () => {
  const page = renderStartPage(ORIGIN)

  it('is an HTML document with the install command', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain(`curl -fsSL ${ORIGIN}/start | sh`)
  })

  it('documents the update command and links the skill', () => {
    expect(page).toContain('sh -s -- update')
    expect(page).toContain(`${ORIGIN}/start/skill`)
  })
})
