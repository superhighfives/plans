import { describe, expect, it } from 'vitest'
import { isPlanPath, parsePlanPath } from './states'

describe('parsePlanPath', () => {
  it('recognizes top-level plan files in each state dir', () => {
    expect(parsePlanPath('plans/backlog/idea.md')).toEqual({ state: 'backlog', slug: 'idea' })
    expect(parsePlanPath('plans/ready/planning-cms.md')).toEqual({
      state: 'ready',
      slug: 'planning-cms',
    })
    expect(parsePlanPath('plans/in-progress/thing.md')).toEqual({
      state: 'in-progress',
      slug: 'thing',
    })
    expect(parsePlanPath('plans/done/shipped.md')).toEqual({ state: 'done', slug: 'shipped' })
  })

  it('rejects non-plan paths (detect-and-skip)', () => {
    // Unknown state directory
    expect(parsePlanPath('plans/archive/x.md')).toBeNull()
    // File directly in plans/
    expect(parsePlanPath('plans/README.md')).toBeNull()
    // Nested deeper than one level
    expect(parsePlanPath('plans/ready/sub/x.md')).toBeNull()
    // Not under top-level plans/
    expect(parsePlanPath('docs/plans/ready/x.md')).toBeNull()
    // Non-markdown
    expect(parsePlanPath('plans/ready/x.txt')).toBeNull()
  })

  it('isPlanPath agrees with parsePlanPath', () => {
    expect(isPlanPath('plans/ready/x.md')).toBe(true)
    expect(isPlanPath('plans/ready/x.txt')).toBe(false)
  })
})
