import { describe, expect, it } from 'vitest'
import {
  isValidPlanFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
} from './frontmatter'

describe('parseFrontmatter', () => {
  it('parses a standard plan document', () => {
    const doc = [
      '---',
      'title: Planning CMS',
      'status: Ready',
      'created: 2026-07-19',
      'updated: 2026-07-19',
      '---',
      '',
      '# Planning CMS',
      '',
      'Body text.',
    ].join('\n')

    const { data, content, hasFrontmatter } = parseFrontmatter(doc)
    expect(hasFrontmatter).toBe(true)
    expect(data).toMatchObject({
      title: 'Planning CMS',
      status: 'Ready',
      created: '2026-07-19',
      updated: '2026-07-19',
    })
    expect(content).toBe('# Planning CMS\n\nBody text.')
  })

  it('handles CRLF line endings', () => {
    const doc = '---\r\ntitle: Foo\r\n---\r\n\r\nBody\r\n'
    const { data, content } = parseFrontmatter(doc)
    expect(data.title).toBe('Foo')
    expect(content.trim()).toBe('Body')
  })

  it('strips surrounding quotes from values', () => {
    const doc = "---\ntitle: \"A: colon title\"\nstatus: 'Backlog'\n---\nBody"
    const { data } = parseFrontmatter(doc)
    expect(data.title).toBe('A: colon title')
    expect(data.status).toBe('Backlog')
  })

  it('preserves colons inside values (only splits on the first)', () => {
    const doc = '---\ntitle: Ratio 16:9 layout\n---\nBody'
    expect(parseFrontmatter(doc).data.title).toBe('Ratio 16:9 layout')
  })

  it('returns no frontmatter for plain markdown', () => {
    const { data, content, hasFrontmatter } = parseFrontmatter('# Just markdown\n\nHi')
    expect(hasFrontmatter).toBe(false)
    expect(data).toEqual({})
    expect(content).toBe('# Just markdown\n\nHi')
  })

  it('treats an unterminated block as no frontmatter', () => {
    const doc = '---\ntitle: Broken\n\nno closing delimiter'
    expect(parseFrontmatter(doc).hasFrontmatter).toBe(false)
  })

  it('handles a BOM prefix', () => {
    const doc = '﻿---\ntitle: Bommed\n---\nBody'
    expect(parseFrontmatter(doc).data.title).toBe('Bommed')
  })
})

describe('serializeFrontmatter', () => {
  it('round-trips a parsed document', () => {
    const doc = '---\ntitle: Foo\nstatus: Ready\n---\n\nHello **world**.'
    const parsed = parseFrontmatter(doc)
    const out = serializeFrontmatter(parsed.data, parsed.content)
    const reparsed = parseFrontmatter(out)
    expect(reparsed.data).toEqual(parsed.data)
    expect(reparsed.content).toBe(parsed.content)
  })

  it('emits keys in canonical order', () => {
    const out = serializeFrontmatter(
      { updated: '2026-01-02', title: 'T', created: '2026-01-01', status: 'Done' },
      'Body',
    )
    expect(out).toBe('---\ntitle: T\nstatus: Done\ncreated: 2026-01-01\nupdated: 2026-01-02\n---\n\nBody')
  })

  it('quotes values that need it', () => {
    const out = serializeFrontmatter({ title: 'has: colon' }, 'x')
    expect(out).toContain('title: "has: colon"')
  })
})

describe('isValidPlanFrontmatter', () => {
  it('requires a non-empty title', () => {
    expect(isValidPlanFrontmatter({ title: 'Something' })).toBe(true)
    expect(isValidPlanFrontmatter({ title: '   ' })).toBe(false)
    expect(isValidPlanFrontmatter({ status: 'Ready' })).toBe(false)
    expect(isValidPlanFrontmatter({})).toBe(false)
  })
})
