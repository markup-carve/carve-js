import type { Citation, CitationGroup, InlineNode } from './ast.js'
import type { CarveExtension, InlineMatch, MatcherContext } from './extension.js'

/** Citation key characters (Pandoc-compatible). */
const KEY = String.raw`[\w][\w:.#$%&+?<>~/-]*`
// One `;`-item: optional prefix, optional `-` (suppress author), `@key`,
// optional `, locator`. Prefix is lazy so it stops at the `-?@key`.
const ITEM_RE = new RegExp(String.raw`^(.*?)(-?)@(${KEY})(?:,\s*(.*))?$`)

export interface CitationsOptions {
  /** `numbered` (default) emits `[1]`; `author-date` emits `(Author Year)`. */
  mode?: 'numbered' | 'author-date'
}

/**
 * Citations (#90, Tier-2). Bracketed `[@key]` references with an in-document
 * `[@key]: entry` bibliography and a generated references list. Bare `@key`
 * stays a core mention; only tail-less brackets containing a `@key` are
 * claimed. See docs/superpowers/specs/2026-06-11-citations-design.md.
 */
export function citations(_opts: CitationsOptions = {}): CarveExtension {
  return {
    name: 'citations',
    matchInline: matchCitation,
  }
}

/** Find the index of the `]` that closes the `[` at `open`, honoring `\]`. */
function closeBracket(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Parse one `;`-item into a Citation, or null if it is not `…@key…`. */
function parseItem(raw: string, ctx: MatcherContext): Citation | null {
  const m = ITEM_RE.exec(raw.trim())
  if (!m) return null
  const prefixText = m[1]!.replace(/\s+$/, '')
  const item: Citation = {
    key: m[3]!,
    suppressAuthor: m[2] === '-',
  }
  if (prefixText !== '') item.prefix = ctx.parseInlines(prefixText)
  const locText = m[4]?.trim()
  if (locText) item.locator = ctx.parseInlines(locText)
  return item
}

const matchCitation = (text: string, pos: number, ctx: MatcherContext): InlineMatch | null => {
  if (text[pos] !== '[') return null
  const close = closeBracket(text, pos)
  if (close === -1) return null
  // A trailing `(`/`[`/`{` means a core link/ref/span owns this bracket.
  const after = text[close + 1]
  if (after === '(' || after === '[' || after === '{') return null

  const inner = text.slice(pos + 1, close)
  if (!inner.includes('@')) return null

  const items: Citation[] = []
  for (const part of inner.split(';')) {
    const item = parseItem(part, ctx)
    if (!item) return null // any non-citation item ⇒ not a citation bracket
    items.push(item)
  }
  if (items.length === 0) return null

  const node: CitationGroup = {
    type: 'citation-group',
    items,
    raw: text.slice(pos, close + 1),
  }
  return { node: node as InlineNode, end: close + 1 }
}
