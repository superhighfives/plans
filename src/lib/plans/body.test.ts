import { describe, expect, it } from 'vitest'
import { stripRedundantHeading } from './body'

describe('stripRedundantHeading', () => {
  it('drops a leading H1 that matches the title', () => {
    const body = '# Planning CMS\n\n## Goal\n\nDo the thing.'
    expect(stripRedundantHeading(body, 'Planning CMS')).toBe(
      '## Goal\n\nDo the thing.',
    )
  })

  it('drops a following metadata line once the title heading is removed', () => {
    const body =
      '# Suggestive Enrich\n**Date**: 2026-07-19 **Status**: Ready\n\n## Goal\n\nBody.'
    expect(stripRedundantHeading(body, 'Suggestive Enrich')).toBe(
      '## Goal\n\nBody.',
    )
  })

  it('drops multiple consecutive metadata lines (Date + Status on separate lines)', () => {
    const body =
      '# Suggestive Enrich\n\n**Date**: 2026-07-19\n**Status**: Ready\n\n## Goal\n\nBody.'
    expect(stripRedundantHeading(body, 'Suggestive Enrich')).toBe(
      '## Goal\n\nBody.',
    )
  })

  it('matches when the H1 has inline markdown the title lacks (backticks)', () => {
    const body =
      '# One-command bootstrap (`/start`)\n\n## Goal\n\nGo.'
    expect(
      stripRedundantHeading(body, 'One-command bootstrap (/start)'),
    ).toBe('## Goal\n\nGo.')
  })

  it('matches the title case-insensitively and ignores surrounding blank lines', () => {
    const body = '\n\n#   suggestive enrich  \n\nContent.'
    expect(stripRedundantHeading(body, 'Suggestive Enrich')).toBe('Content.')
  })

  it('leaves the body untouched when the first heading is not the title', () => {
    const body = '# Something Else\n\nContent.'
    expect(stripRedundantHeading(body, 'Suggestive Enrich')).toBe(body)
  })

  it('leaves the body untouched when it does not start with an H1', () => {
    const body = '## Goal\n\nContent.'
    expect(stripRedundantHeading(body, 'Goal')).toBe(body)
  })

  it('does not strip a metadata line when no title heading preceded it', () => {
    const body = '**Status**: Ready\n\nContent.'
    expect(stripRedundantHeading(body, 'Whatever')).toBe(body)
  })

  it('keeps content when only the H1 is present', () => {
    expect(stripRedundantHeading('# Title', 'Title')).toBe('')
  })
})
