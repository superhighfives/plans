import { describe, expect, it } from 'vitest'
import { selectContextPaths } from './codebase'

describe('selectContextPaths', () => {
  const tree = [
    'README.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'wrangler.jsonc',
    'biome.json',
    '.github/workflows/ci.yml',
    'src/index.ts',
    'src/lib/util.ts',
    'src/components/Button.tsx',
    'docs/guide/readme.md',
    'node_modules/react/package.json',
    'dist/index.js',
    'test/fixtures/package.json',
  ]

  it('keeps manifests, config, docs, and CI; drops source + vendored/generated', () => {
    const picked = selectContextPaths(tree)
    expect(picked).toContain('package.json')
    expect(picked).toContain('tsconfig.json')
    expect(picked).toContain('wrangler.jsonc')
    expect(picked).toContain('.github/workflows/ci.yml')
    expect(picked).toContain('README.md')
    // Ordinary source is not context.
    expect(picked).not.toContain('src/index.ts')
    // Vendored / generated dirs are excluded even when the basename matches.
    expect(picked).not.toContain('node_modules/react/package.json')
    expect(picked).not.toContain('dist/index.js')
  })

  it('orders shallowest-first so root files win', () => {
    const picked = selectContextPaths(['docs/guide/readme.md', 'README.md'])
    expect(picked[0]).toBe('README.md')
  })

  it('caps the result at the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => `pkg${i}/package.json`)
    expect(selectContextPaths(many, { limit: 10 })).toHaveLength(10)
  })
})
