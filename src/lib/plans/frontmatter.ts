/**
 * A small, dependency-free frontmatter parser for the planning skill's format.
 *
 * The skill writes a leading `---` YAML block with simple scalar keys
 * (`title`, `status`, `created`, `updated`) followed by a markdown body. We
 * intentionally do NOT pull in a full YAML library: the format is a flat set of
 * `key: value` pairs, and avoiding `Buffer`/Node deps keeps this safe on the
 * Workers runtime. Nested structures are not supported (and not used by plans).
 */

export interface Frontmatter {
  title?: string
  status?: string
  created?: string
  updated?: string
  [key: string]: string | undefined
}

export interface ParsedPlan {
  /** Parsed frontmatter (empty object if none). */
  data: Frontmatter
  /** The markdown body after the frontmatter block. */
  content: string
  /** Whether a well-formed frontmatter block was present. */
  hasFrontmatter: boolean
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/**
 * Parse a markdown document into frontmatter + body.
 *
 * Recognizes a block delimited by a leading `---` line and a closing `---`
 * line. Tolerates `\r\n` line endings and leading whitespace/BOM.
 */
export function parseFrontmatter(input: string): ParsedPlan {
  const text = input.replace(/^﻿/, '')
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  if (lines[0]?.trim() !== '---') {
    return { data: {}, content: input, hasFrontmatter: false }
  }

  // Find the closing '---' delimiter line.
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    return { data: {}, content: input, hasFrontmatter: false }
  }

  const data: Frontmatter = {}
  for (const rawLine of lines.slice(1, closeIdx)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (!key) continue
    data[key] = stripQuotes(line.slice(colon + 1))
  }

  // Body is everything after the closing delimiter, minus one leading blank line.
  const body = lines
    .slice(closeIdx + 1)
    .join('\n')
    .replace(/^\n/, '')
  return { data, content: body, hasFrontmatter: true }
}

/**
 * Serialize frontmatter + body back into a markdown document. Used by the
 * write path (Phase 2). Emits keys in a stable, plan-friendly order.
 */
export function serializeFrontmatter(
  data: Frontmatter,
  content: string,
): string {
  const ORDER = ['title', 'status', 'created', 'updated']
  const keys = [
    ...ORDER.filter((k) => data[k] != null),
    ...Object.keys(data).filter((k) => !ORDER.includes(k) && data[k] != null),
  ]
  const lines = keys.map((k) => `${k}: ${formatValue(String(data[k]))}`)
  const body = content.startsWith('\n') ? content : `\n${content}`
  return `---\n${lines.join('\n')}\n---\n${body}`
}

function formatValue(value: string): string {
  // Quote when the value could otherwise be misread (leading/trailing space,
  // a leading special char, or an embedded colon-space).
  if (
    value === '' ||
    /^[\s>|@`"'\-?:&*!%#]/.test(value) ||
    /:\s/.test(value) ||
    /\s$/.test(value)
  ) {
    return JSON.stringify(value)
  }
  return value
}

/** A plan is recognized only when it has the skill's minimum frontmatter. */
export function isValidPlanFrontmatter(data: Frontmatter): boolean {
  return typeof data.title === 'string' && data.title.trim().length > 0
}
