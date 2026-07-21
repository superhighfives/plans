import { describe, expect, it } from 'vitest'
import { diffLines, unifiedDiff } from './text-diff'

describe('diffLines', () => {
  it('marks identical text as all context with no changes', () => {
    const text = 'a\nb\nc'
    const lines = diffLines(text, text)
    expect(lines.every((l) => l.type === 'context')).toBe(true)
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
  })

  it('tracks a single added line with correct line numbers', () => {
    const lines = diffLines('a\nc', 'a\nb\nc')
    expect(lines).toEqual([
      { type: 'context', baseNo: 1, headNo: 1, text: 'a' },
      { type: 'add', baseNo: null, headNo: 2, text: 'b' },
      { type: 'context', baseNo: 2, headNo: 3, text: 'c' },
    ])
  })

  it('tracks a deletion', () => {
    const lines = diffLines('a\nb\nc', 'a\nc')
    expect(lines).toEqual([
      { type: 'context', baseNo: 1, headNo: 1, text: 'a' },
      { type: 'del', baseNo: 2, headNo: null, text: 'b' },
      { type: 'context', baseNo: 3, headNo: 2, text: 'c' },
    ])
  })

  it('represents a modified line as a delete + add pair', () => {
    const lines = diffLines('a\nold\nc', 'a\nnew\nc')
    expect(lines.map((l) => [l.type, l.text])).toEqual([
      ['context', 'a'],
      ['del', 'old'],
      ['add', 'new'],
      ['context', 'c'],
    ])
  })

  it('ignores a single trailing newline', () => {
    expect(diffLines('a\nb\n', 'a\nb')).toEqual(diffLines('a\nb', 'a\nb'))
  })
})

describe('unifiedDiff', () => {
  it('returns no hunks and zero counts for identical text', () => {
    const d = unifiedDiff('x\ny\nz', 'x\ny\nz')
    expect(d).toEqual({ hunks: [], additions: 0, deletions: 0 })
  })

  it('counts additions and deletions', () => {
    const d = unifiedDiff('a\nb\nc', 'a\nB\nc\nd')
    expect(d.additions).toBe(2) // B, d
    expect(d.deletions).toBe(1) // b
  })

  it('surrounds a change with context and reports hunk ranges', () => {
    const base = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n')
    const head = ['1', '2', '3', '4', 'FIVE', '6', '7', '8', '9'].join('\n')
    const d = unifiedDiff(base, head, 2)
    expect(d.hunks).toHaveLength(1)
    const hunk = d.hunks[0]!
    // change at line 5, 2 lines of context each side → lines 3..7
    expect(hunk.baseStart).toBe(3)
    expect(hunk.lines.map((l) => [l.type, l.text])).toEqual([
      ['context', '3'],
      ['context', '4'],
      ['del', '5'],
      ['add', 'FIVE'],
      ['context', '6'],
      ['context', '7'],
    ])
  })

  it('splits distant changes into separate hunks', () => {
    const base = Array.from({ length: 20 }, (_, i) => String(i + 1)).join('\n')
    const headArr = Array.from({ length: 20 }, (_, i) => String(i + 1))
    headArr[1] = 'TWO' // line 2
    headArr[18] = 'NINETEEN' // line 19
    const d = unifiedDiff(base, headArr.join('\n'), 3)
    expect(d.hunks).toHaveLength(2)
  })

  it('merges nearby changes into one hunk', () => {
    const base = Array.from({ length: 20 }, (_, i) => String(i + 1)).join('\n')
    const headArr = Array.from({ length: 20 }, (_, i) => String(i + 1))
    headArr[9] = 'TEN'
    headArr[11] = 'TWELVE'
    const d = unifiedDiff(base, headArr.join('\n'), 3)
    expect(d.hunks).toHaveLength(1)
  })
})
