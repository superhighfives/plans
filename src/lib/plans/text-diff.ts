/**
 * A small, dependency-free unified-diff engine for plan bodies. Used by the
 * detail view to show what an open PR changes relative to the default branch.
 *
 * Line-based LCS (good enough for prose/markdown), grouped into hunks with a few
 * lines of surrounding context — the familiar `git diff` shape. Pure and
 * side-effect-free so it's cheap to unit test.
 */

export type DiffLineType = 'context' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  /** 1-based line number in the base (default-branch) text; null for additions. */
  baseNo: number | null
  /** 1-based line number in the head (branch) text; null for deletions. */
  headNo: number | null
  text: string
}

export interface DiffHunk {
  baseStart: number
  baseLines: number
  headStart: number
  headLines: number
  lines: DiffLine[]
}

export interface UnifiedDiff {
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

/** Split into lines, ignoring a single trailing newline so it doesn't show as an empty line. */
function splitLines(text: string): string[] {
  return text.replace(/\n$/, '').split('\n')
}

/**
 * Full line-by-line diff (no hunking). Longest-common-subsequence via a DP
 * table, then a backtrack that prefers deletions before additions for stable
 * output. O(n·m) time/space — fine for plan-sized documents.
 */
export function diffLines(baseText: string, headText: string): DiffLine[] {
  const a = splitLines(baseText)
  const b = splitLines(headText)
  const n = a.length
  const m = b.length

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] as number[]
    const next = dp[i + 1] as number[]
    const ai = a[i] as string
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        ai === (b[j] as string)
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let baseNo = 1
  let headNo = 1
  while (i < n && j < m) {
    const ai = a[i] as string
    if (ai === (b[j] as string)) {
      out.push({ type: 'context', baseNo, headNo, text: ai })
      i++
      j++
      baseNo++
      headNo++
    } else if (
      ((dp[i + 1] as number[])[j] as number) >=
      ((dp[i] as number[])[j + 1] as number)
    ) {
      out.push({ type: 'del', baseNo, headNo: null, text: ai })
      i++
      baseNo++
    } else {
      out.push({ type: 'add', baseNo: null, headNo, text: b[j] as string })
      j++
      headNo++
    }
  }
  while (i < n) {
    out.push({ type: 'del', baseNo, headNo: null, text: a[i] as string })
    i++
    baseNo++
  }
  while (j < m) {
    out.push({ type: 'add', baseNo: null, headNo, text: b[j] as string })
    j++
    headNo++
  }
  return out
}

/** Group a line diff into hunks, keeping `context` unchanged lines around each change. */
function buildHunks(lines: DiffLine[], context: number): DiffHunk[] {
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] as DiffLine).type === 'context') continue
    const start = Math.max(0, i - context)
    const end = Math.min(lines.length - 1, i + context)
    const last = ranges[ranges.length - 1]
    // Merge with the previous range when their context windows touch or overlap.
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end)
    } else {
      ranges.push([start, end])
    }
  }

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1)
    const baseStart = slice.find((l) => l.baseNo != null)?.baseNo ?? 0
    const headStart = slice.find((l) => l.headNo != null)?.headNo ?? 0
    return {
      baseStart,
      baseLines: slice.filter((l) => l.type !== 'add').length,
      headStart,
      headLines: slice.filter((l) => l.type !== 'del').length,
      lines: slice,
    }
  })
}

/**
 * Compute a unified diff from `baseText` to `headText`. Returns empty `hunks`
 * (and zero counts) when the texts are identical.
 */
export function unifiedDiff(
  baseText: string,
  headText: string,
  context = 3,
): UnifiedDiff {
  const lines = diffLines(baseText, headText)
  return {
    hunks: buildHunks(lines, context),
    additions: lines.filter((l) => l.type === 'add').length,
    deletions: lines.filter((l) => l.type === 'del').length,
  }
}
