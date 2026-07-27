import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from './slug'

describe('slugify', () => {
  it('kebab-cases a title, collapsing punctuation and whitespace', () => {
    expect(slugify('Add OAuth login')).toBe('add-oauth-login')
    expect(slugify('  Rate-limit the API!!  ')).toBe('rate-limit-the-api')
    expect(slugify('Cache: plans & repos')).toBe('cache-plans-repos')
  })

  it('strips diacritics rather than dropping the letters', () => {
    expect(slugify('Café résumé')).toBe('cafe-resume')
  })

  it('falls back to "untitled" when nothing usable remains', () => {
    expect(slugify('')).toBe('untitled')
    expect(slugify('!!! ??? ...')).toBe('untitled')
    expect(slugify('日本語')).toBe('untitled')
  })

  it('caps the length without leaving a trailing hyphen', () => {
    const long = 'word '.repeat(30).trim()
    const slug = slugify(long)
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug.startsWith('-')).toBe(false)
  })
})

describe('uniqueSlug', () => {
  it('returns the base when it is free', () => {
    expect(uniqueSlug('caching', new Set())).toBe('caching')
    expect(uniqueSlug('caching', new Set(['other']))).toBe('caching')
  })

  it('appends the first free -N suffix on collision', () => {
    expect(uniqueSlug('caching', new Set(['caching']))).toBe('caching-2')
    expect(uniqueSlug('caching', new Set(['caching', 'caching-2']))).toBe(
      'caching-3',
    )
  })
})
