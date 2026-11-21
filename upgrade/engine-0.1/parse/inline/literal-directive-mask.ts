import { isLiteralInlineDirective, scanDirectiveShape } from '../../include-directive.js'
import { verbatimSpanEnd } from './parse-brackets.js'

const TOKENS = '`$%[]{'
const PRIVATE_USE_START = 0xe100
const PRIVATE_USE_END = 0xf8ff

export interface MaskedInline {
  text: string
  base: number
}

/** A private-use block of stand-ins the text does not hold, or undefined when none is free. */
function freeMaskBase(text: string): number | undefined {
  const used = new Set<number>()
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code >= PRIVATE_USE_START && code <= PRIVATE_USE_END) used.add(code)
  }
  for (let base = PRIVATE_USE_START; base + TOKENS.length - 1 <= PRIVATE_USE_END; base += TOKENS.length) {
    let free = true
    for (let i = 0; i < TOKENS.length; i++) if (used.has(base + i)) free = false
    if (free) return base
  }
  return undefined
}

/**
 * CARVE-P6-001: a token inside a literal directive opens nothing, so the closer
 * scans must not see a run-to-the-end opener there. Offsets are preserved;
 * `unmaskLiteralDirectiveTokens` restores the characters in the parsed nodes.
 */
export function maskLiteralDirectiveTokens(text: string): MaskedInline | undefined {
  if (!text.includes('{{')) return undefined
  let out: string | undefined
  let base: number | undefined
  for (let at = 0; at < text.length; at++) {
    const ch = text[at]
    if (ch === '\\') at++
    else if (ch === '`') {
      const span = verbatimSpanEnd(text, at)
      if (!span.closed) break
      at = span.end - 1
    } else if (ch === '{' && text[at + 1] === '{') {
      const shape = scanDirectiveShape(text, at)
      if (!shape || !isLiteralInlineDirective(shape)) continue
      const inner = text.slice(at + 2, shape.end)
      if (/[`$%[\]{]/.test(inner)) {
        base ??= freeMaskBase(text)
        if (base === undefined) return undefined
        const from = base
        out = (out ?? text).slice(0, at + 2)
          + inner.replace(/[`$%[\]{]/g, c => String.fromCharCode(from + TOKENS.indexOf(c)))
          + text.slice(shape.end)
      }
      at = shape.end - 1
    }
  }
  return out === undefined ? undefined : { text: out, base: base! }
}

export function unmaskLiteralDirectiveTokens(value: unknown, base: number): void {
  const restore = (entry: string): string => {
    let out = ''
    for (let at = 0; at < entry.length; at++) {
      const offset = entry.charCodeAt(at) - base
      out += offset >= 0 && offset < TOKENS.length ? TOKENS[offset]! : entry[at]!
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const [i, entry] of value.entries()) {
      if (typeof entry === 'string') value[i] = restore(entry)
      else unmaskLiteralDirectiveTokens(entry, base)
    }
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      const entry = record[key]
      if (typeof entry === 'string') record[key] = restore(entry)
      else unmaskLiteralDirectiveTokens(entry, base)
    }
  }
}
