import { describe, expect, it } from 'vitest'
import { diffPlanTrees, type PlanEntry } from './diff'

const base: PlanEntry[] = [
  { path: 'plans/backlog/idea.md', sha: 'aaa' },
  { path: 'plans/in-progress/feature.md', sha: 'bbb' },
  { path: 'plans/ready/spec.md', sha: 'ccc' },
]

describe('diffPlanTrees', () => {
  it('returns no changes when the trees are identical', () => {
    expect(diffPlanTrees(base, base)).toEqual([])
  })

  it('detects a new plan added on the head branch', () => {
    const head = [...base, { path: 'plans/backlog/new-thing.md', sha: 'ddd' }]
    expect(diffPlanTrees(base, head)).toEqual([
      {
        kind: 'added',
        slug: 'new-thing',
        headPath: 'plans/backlog/new-thing.md',
        headState: 'backlog',
        basePath: null,
        baseState: null,
      },
    ])
  })

  it('detects a plan moved between states as a single change, not add+remove', () => {
    const head: PlanEntry[] = [
      { path: 'plans/backlog/idea.md', sha: 'aaa' },
      // feature.md moved in-progress -> done (sha may also change)
      { path: 'plans/done/feature.md', sha: 'bbb2' },
      { path: 'plans/ready/spec.md', sha: 'ccc' },
    ]
    expect(diffPlanTrees(base, head)).toEqual([
      {
        kind: 'moved',
        slug: 'feature',
        headPath: 'plans/done/feature.md',
        headState: 'done',
        basePath: 'plans/in-progress/feature.md',
        baseState: 'in-progress',
      },
    ])
  })

  it('detects an in-place modification via changed blob sha', () => {
    const head: PlanEntry[] = [
      { path: 'plans/backlog/idea.md', sha: 'aaa' },
      { path: 'plans/in-progress/feature.md', sha: 'bbb' },
      { path: 'plans/ready/spec.md', sha: 'ccc-edited' },
    ]
    expect(diffPlanTrees(base, head)).toEqual([
      {
        kind: 'modified',
        slug: 'spec',
        headPath: 'plans/ready/spec.md',
        headState: 'ready',
        basePath: 'plans/ready/spec.md',
        baseState: 'ready',
      },
    ])
  })

  it('detects a plan removed on the head branch', () => {
    const head: PlanEntry[] = [
      { path: 'plans/backlog/idea.md', sha: 'aaa' },
      { path: 'plans/in-progress/feature.md', sha: 'bbb' },
    ]
    expect(diffPlanTrees(base, head)).toEqual([
      {
        kind: 'removed',
        slug: 'spec',
        headPath: null,
        headState: null,
        basePath: 'plans/ready/spec.md',
        baseState: 'ready',
      },
    ])
  })

  it('ignores non-plan paths on either side', () => {
    const noisyBase = [...base, { path: 'README.md', sha: 'zzz' }]
    const noisyHead = [
      ...base,
      { path: 'plans/notes.md', sha: 'yyy' },
      { path: 'plans/archive/old.md', sha: 'xxx' },
    ]
    expect(diffPlanTrees(noisyBase, noisyHead)).toEqual([])
  })

  it('reports multiple independent changes together', () => {
    const head: PlanEntry[] = [
      { path: 'plans/ready/idea.md', sha: 'aaa' }, // moved backlog -> ready
      { path: 'plans/in-progress/feature.md', sha: 'bbb-edited' }, // modified
      // spec.md removed
      { path: 'plans/backlog/brand-new.md', sha: 'nnn' }, // added
    ]
    const changes = diffPlanTrees(base, head)
    expect(changes).toHaveLength(4)
    expect(changes.map((c) => [c.kind, c.slug]).sort()).toEqual([
      ['added', 'brand-new'],
      ['modified', 'feature'],
      ['moved', 'idea'],
      ['removed', 'spec'],
    ])
  })
})
