// The parts of one-line blocks that the block pass does not read: the title of an opener, the
// fields of a link definition and of an include directive.
import { type AstNode } from './ast.ts'
import { FLOW_PLAIN, inlineNodes, type TreeContext } from './ast-inline.ts'
import { unescape } from './attributes.ts'
import { scanInline } from './inline-scan.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import { buildInlineTree } from './inline-tree.ts'
import { quotedEnd, skipSpaces, trimEnd } from './lines.ts'
import { isSpaceOrTab } from './source.ts'

// C2-W-058: the options of an include directive stand in this order, and any other option behind them as written.
const INCLUDE_OPTIONS = ['lines', 'region', 'rows', 'cols', 'shift', 'code']

/** The quoted title of a code fence, without its escapes (C2-B-120). */
export function openerTitle(src: string, start: number, end: number): string {
  return unescape(src, start, end)
}

/** The inline content of `[start, end)`, one line of the source: the title of a div, an admonition or a directive. */
export function captionChildren(ctx: TreeContext, start: number, end: number): AstNode[] {
  const state = acquireInlineState()
  try {
    scanInline(state, ctx.src, [start, end], 0, 2, 0, false)
    const nodes = buildInlineTree(ctx.src, state.events, state.eventLength, (from, to) => ctx.src.slice(from, to))
    return inlineNodes(ctx, nodes, FLOW_PLAIN)
  } finally {
    releaseInlineState(state)
  }
}

/** C2-B-083: the destination and the optional quoted title behind the colon of a link definition. */
export function linkDefinitionFields(src: string, pos: number, end: number, out: AstNode): void {
  let p = skipSpaces(src, pos, end)
  const start = p
  while (p < end && !isSpaceOrTab(src.charCodeAt(p)) && src[p] !== '"') p++
  out.href = src.slice(start, p)
  p = skipSpaces(src, p, end)
  if (p >= end || src[p] !== '"') return
  const after = quotedEnd(src, p, end)
  if (after >= 0) out.title = unescape(src, p + 1, after - 1)
}

/** The offset behind the quoted run that opens at `pos`, or `end`. */
function quotedRunEnd(src: string, pos: number, end: number): number {
  const quote = src[pos]
  for (let p = pos + 1; p < end; p++) {
    if (src[p] === '\\') p++
    else if (src[p] === quote) return p + 1
  }
  return end
}

/** The parts of the option slot: they are separated by spaces, and an at-sign starts a new one. */
function optionParts(src: string, pos: number, end: number): string[] {
  const parts: string[] = []
  let start = pos
  for (let p = pos; p < end; p++) {
    const char = src[p]
    if (char === '"' || char === "'") {
      p = quotedRunEnd(src, p, end) - 1
    } else if (char === ' ' || (char === '@' && p > start)) {
      if (p > start) parts.push(src.slice(start, p))
      start = char === ' ' ? p + 1 : p
    }
  }
  if (start < end) parts.push(src.slice(start, end))
  return parts
}

function unquoted(value: string): string {
  const quote = value[0]
  if ((quote !== '"' && quote !== "'") || value.length < 2 || !value.endsWith(quote)) return value
  return unescape(value, 1, value.length - 1)
}

/** `@name:value` as a pair, or null. */
function optionPair(part: string): [string, string] | null {
  const colon = part.indexOf(':')
  if (!part.startsWith('@') || colon < 2) return null
  return [part.slice(1, colon), unquoted(part.slice(colon + 1))]
}

function optionRank(name: string): number {
  const rank = INCLUDE_OPTIONS.indexOf(name)
  return rank < 0 ? INCLUDE_OPTIONS.length : rank
}

/** The offset behind the path that starts at `pos`: a quoted run, or a run without a space, `#` and `@`. */
function pathEnd(src: string, pos: number, end: number): number {
  if (src[pos] === '"') return quotedRunEnd(src, pos, end)
  let p = pos
  while (p < end && src[p] !== ' ' && src[p] !== '#' && src[p] !== '@') p++
  return p
}

/**
 * C2-A-181: the include directive on the line `[start, end)`: `{{`, a path, an optional `#section`
 * and options of the form `@name:value` (CARVE-P6-001), `}}`.
 */
export function includeNode(src: string, start: number, end: number): AstNode {
  const close = trimEnd(src, start, end) - 2
  const inner = trimEnd(src, start, close)
  let p = skipSpaces(src, start + 2, inner)
  const afterPath = pathEnd(src, p, inner)
  const out: AstNode = { type: 'include', path: unquoted(src.slice(p, afterPath)) }
  p = skipSpaces(src, afterPath, inner)
  if (src[p] === '#') {
    const sectionStart = p + 1
    while (p < inner && src[p] !== ' ' && src[p] !== '@') p++
    out.section = src.slice(sectionStart, p)
  }
  const pairs: [string, string][] = []
  for (const part of optionParts(src, skipSpaces(src, p, inner), inner)) {
    const pair = optionPair(part)
    // A part that is no option keeps its text, so that nothing the author wrote is lost.
    pairs.push(pair ?? ['', part])
  }
  // The sort is stable, so options of one rank keep their written order.
  pairs.sort((a, b) => optionRank(a[0]) - optionRank(b[0]))
  if (pairs.length > 0) out.options = pairs
  return out
}
