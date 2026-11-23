// Contract 2.11 and 2.13: inline spellings, read off the inline nodes of the 0.1 tree.
import { isAsciiDigit, isWordCharacter } from '../../../src/unicode.ts'
import { ancestor, isInside } from '../blocks.ts'
import { change, type Context, note, noteRange, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { headingTexts, isUnresolved } from './references.ts'

const BRACE = 0x7b
const OPEN_RUNS: readonly string[] = ['code', 'math', 'literal_inline']

function hasClosingRun(src: string, openerEnd: number, end: number, width: number): boolean {
  for (let at = openerEnd; at < end; at++) {
    if (src[at] !== '`') continue
    let run = 0
    while (src[at + run] === '`') run++
    if (run === width && src[at - 1] !== '\\') return true
    at += run - 1
  }
  return false
}

function canCloseRun(visit: Visit, late: boolean): boolean {
  // C2-B-169: in a cell the closer on the line keeps the pipes inside the span, so the late pass tries every host.
  if (late) return OPEN_RUNS.includes(visit.node.type) && visit.node.pos !== undefined
  return OPEN_RUNS.includes(visit.node.type) && visit.node.pos !== undefined
    && ancestor(visit, 'block_quote') === null && ancestor(visit, 'line_block') === null
    && ancestor(visit, 'table') === null && ancestor(visit, 'figure') === null
}

function canReportRun(visit: Visit, late: boolean): boolean {
  if (late) return canCloseRun(visit, late)
  return OPEN_RUNS.includes(visit.node.type) && visit.node.pos !== undefined && ancestor(visit, 'line_block') === null
    && ancestor(visit, 'table') === null && ancestor(visit, 'figure') === null
}

/** Where the backticks of a run start, after a literal or math sigil. */
function runStart(src: string, start: number): number {
  let at = start
  if (src[at] === '!' || src[at] === '$') at++
  if (src[start] === '$' && src[at] === '$') at++
  return at
}

function unclosedRun(ctx: Context, visit: Visit): void {
  const node = visit.node
  if (!canReportRun(visit, ctx.late)) return
  const { startOffset: start, endOffset: end, startLine } = node.pos!
  const at = runStart(ctx.src, start)
  if (ctx.src[at] !== '`') return
  let width = 0
  while (ctx.src[at + width] === '`') width++
  const openerEnd = at + width
  const mark = '`'.repeat(width)
  if (hasClosingRun(ctx.src, openerEnd, end, width)) return
  // The U-105 comment before a run that opens its paragraph leaves the run to close.
  if (ctx.findings.some((finding) => finding.edit !== null && start <= finding.offset && finding.offset <= end
    && !(finding.edit.entry === 'U-105' && finding.edit.start === start && finding.edit.end === start))) return
  // An empty run is only reported, so a quote can hold it too.
  if (end > openerEnd) {
    if (canCloseRun(visit, ctx.late)) closeRun(ctx, startLine, start, openerEnd, end, mark)
    return
  }
  noteRange(ctx, node.type === 'math' ? 'U-396' : 'U-439', startLine, start, end,
    'the empty 0.1 inline value has no verified 0.2 spelling')
}

function closeRun(ctx: Context, line: number, start: number, openerEnd: number, end: number, mark: string): void {
  // C2-I-016: a value that starts or ends with a backtick is padded with one space on each side.
  const pad = ctx.src[end - 1] === '`'
  // C2-W-077: the pad before a leading line break is trailing whitespace, so such a value has no spelling.
  if (pad && (ctx.src[openerEnd] === '\n' || ctx.src[openerEnd] === '\r')) {
    noteRange(ctx, 'U-439', line, start, end, 'the 0.1 inline value starts with a line break and ends with a backtick')
    return
  }
  const from = pad ? openerEnd : end
  change(ctx, 'U-258', from, end, pad ? ` ${ctx.src.slice(openerEnd, end)} ${mark}` : mark,
    'unclosed 0.1 inline run closed at its content end')
}

interface Bare {
  mark: string
  entry: string
  name: string
}

/** C2-I-046: these three delimiters form a span only in braces. */
const BARE: Record<string, Bare> = {
  underline: { mark: '_', entry: 'U-065', name: 'underline' },
  strike: { mark: '~', entry: 'U-066', name: 'strike' },
  highlight: { mark: '=', entry: 'U-067', name: 'highlight' }
}

/** The start of the attribute block that ends at `end`, or `end` when the span has none. */
function attributeStart(src: string, end: number): number {
  if (src[end - 1] !== '}') return end
  let depth = 0
  for (let at = end - 1; at >= 0; at--) {
    if (src[at] === '}') depth++
    else if (src[at] === '{' && --depth === 0) return at
  }
  return end
}

/** The last unescaped `{` of `start` to `end` that no `}` closes there, or -1: 0.2 reads it before the closer. */
function unbalancedBrace(src: string, start: number, end: number): number {
  const open: number[] = []
  for (let at = start; at < end; at++) {
    if (src[at] === '\\') { at++; continue }
    if (src[at] === '{') open.push(at)
    else if (src[at] === '}') open.pop()
  }
  return open.at(-1) ?? -1
}

function bareSpan(ctx: Context, node: Node01, bare: Bare): void {
  if (node.pos === undefined) return
  const { startOffset: start } = node.pos
  // The closer of a span with a glued attribute block goes before the block. An underline is left to
  // U-151: bracing it alone can leave its line half rewritten.
  const glued = node.attrs !== undefined && bare.entry !== 'U-065'
  const end = glued ? attributeStart(ctx.src, node.pos.endOffset) : node.pos.endOffset
  if (ctx.src[start] !== bare.mark || ctx.src[end - 1] !== bare.mark || end - start < 2) return
  // C2-B-171: a brace block glued to a cell's pipe is the attribute block of the cell, so a space goes between.
  change(ctx, bare.entry, start, start, ctx.src[start - 1] === '|' ? ' {' : '{', `bare ${bare.name} put in braces`)
  change(ctx, bare.entry, end, end, '}', `bare ${bare.name} put in braces`)
  const open = ctx.late ? unbalancedBrace(ctx.src, start + 1, end - 1) : -1
  if (open >= 0) change(ctx, bare.entry, open, open, '\\', `brace escaped so the braced ${bare.name} closes`)
  if (bare.entry !== 'U-065') return
  const source = ctx.src.slice(start, end)
  if (!/^_[A-Za-z_][A-Za-z0-9_-]*=[^\s{}=]+_$/u.test(source)) return
  const equal = start + source.indexOf('=')
  change(ctx, 'U-267', equal, equal, '\\', 'equals sign escaped so the braced underline is not an attribute')
}

/** U-068: 0.1 read `/*` as one token of strong around emphasis; 0.2 nests as written (C2-I-052). */
function boldItalic(ctx: Context, node: Node01): void {
  const { startOffset: start } = node.pos!
  const end = ctx.late && node.attrs !== undefined ? attributeStart(ctx.src, node.pos!.endOffset) : node.pos!.endOffset
  if (node.boldItalic !== true || !ctx.src.startsWith('/*', start) || !ctx.src.startsWith('*/', end - 2)) return
  if (bracedBoldItalic) { bracedSpans(ctx, node, start, end); return }
  change(ctx, 'U-068', start, start + 2, '*/', 'emphasis outside strong respelled as strong outside emphasis')
  change(ctx, 'U-068', end - 2, end, '/*', 'emphasis outside strong respelled as strong outside emphasis')
}

/** Set while `inlineBraced` runs. */
let bracedBoldItalic = false

const textOnly = (node: Node01): boolean => (node.children ?? []).every((child) => child.type === 'text'
  || child.type === 'soft_break' || (child.type === 'emphasis' && textOnly(child)))

/**
 * U-068 as explicit braced spans, the spelling of `rescueBracedBoldItalic`, for a span inside a larger
 * document. C2-I-011: text content gets its punctuation escaped, so 0.2 pairs no delimiter in it.
 */
function bracedSpans(ctx: Context, node: Node01, start: number, end: number): void {
  const message = 'emphasis outside strong written as explicit braced spans so its content stays text'
  change(ctx, 'U-068', start, start + 2, '{*{/', message)
  change(ctx, 'U-068', end - 2, end, '/}*}', message)
  if (!textOnly(node)) return
  for (let at = start + 2; at < end - 2; at++) {
    if (/[!-/:-@[-`{-~]/u.test(ctx.src[at]!)) change(ctx, 'U-068', at, at, '\\', message)
  }
}

/** The late form of `inline` that writes bold italic as braced spans. */
export function inlineBraced(ctx: Context): void {
  bracedBoldItalic = true
  try { inline(ctx) } finally { bracedBoldItalic = false }
}

function deletionTagName(ctx: Context, node: Node01): void {
  const { startOffset: start, endOffset: end } = node.pos!
  const [brace, tag] = node.children ?? []
  if (brace?.type !== 'text' || brace.value !== '{' || brace.pos?.startOffset !== start + 2
    || tag?.type !== 'tag' || tag.pos?.startOffset !== start + 3
    || !ctx.src.startsWith('{-{#', start) || !ctx.src.startsWith('-}', end - 2)) return
  change(ctx, 'U-365', start + 2, start + 2, '\\', 'inner brace escaped so the deletion closer remains visible')
}

function lastEnd(nodes: unknown, fallback: number): number {
  if (!Array.isArray(nodes) || nodes.length === 0) return fallback
  const last = nodes[nodes.length - 1] as Node01
  return last.pos === undefined ? fallback : last.pos.endOffset
}

function substitutionTextComments(ctx: Context, nodes: unknown): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes as Node01[]) {
    if (node.type !== 'text' || node.pos === undefined) continue
    for (let at = node.pos.startOffset; at + 1 < node.pos.endOffset; at++) {
      if (!ctx.src.startsWith('%%', at) || escapedBrace(ctx.src, at)) continue
      change(ctx, 'U-069', at, at, '\\', 'comment mark kept as text in the parsed 0.1 substitution')
      at++
    }
  }
}

/** U-069: there is no arrow form in 0.2 (C2-I-062). */
function substitution(ctx: Context, node: Node01): void {
  if (node.pos === undefined) return
  const { startOffset: start, endOffset: end, startLine } = node.pos
  if (!ctx.src.startsWith('{~', start) || !ctx.src.startsWith('~}', end - 2)) return
  if ((Array.isArray(node.old) && node.old.length === 0) || (Array.isArray(node.new) && node.new.length === 0)) {
    note(
      ctx,
      'U-198',
      startLine,
      'an empty side of the 0.1 replacement has no 0.2 inline spelling under C2-I-062 and C2-W-116'
    )
    return
  }
  const arrow = ctx.src.indexOf('~>', lastEnd(node.old, start + 2))
  if (arrow < 0 || arrow >= end - 2) return
  const message = 'substitution arrow respelled as a deletion and an insertion'
  change(ctx, 'U-069', start, start + 2, '{-', message)
  change(ctx, 'U-069', arrow, arrow + 2, '-}{+', message)
  change(ctx, 'U-069', end - 2, end, '+}', message)
  // 0.1 wrote a glued attribute block as text; on the insertion it would apply (C2-I-028).
  if (ctx.repairs === true && ctx.src[end] === '{') change(ctx, 'U-069', end, end, '\\', message)
  substitutionTextComments(ctx, node.old)
  substitutionTextComments(ctx, node.new)
}

/** C2-I-104: whitespace, a no-break space or opening punctuation before a quote opens it. */
const OPENS_AFTER = new Set([0x20, 0x09, 0x0a, 0xa0, 0x28, 0x5b, 0x7b, 0x3d, 0x3a, 0x201c, 0x2018])

function isOpeningPlace(src: string, at: number): boolean {
  return at === 0 || OPENS_AFTER.has(src.charCodeAt(at - 1))
}


/** U-071: 0.1 demoted an opening single quote with no closer; 0.2 opens it by its neighbors alone (C2-I-104, C2-I-105). */
function demotedQuote(ctx: Context, node: Node01): void {
  const start = node.pos!.startOffset
  if (node.kind !== 'right_single_quote' || ctx.src[start] !== "'" || !isOpeningPlace(ctx.src, start)) return
  const next = ctx.src.charCodeAt(start + 1)
  if (Number.isNaN(next) || next === 0x20 || next === 0x0a || isAsciiDigit(next)) return
  change(
    ctx,
    'U-071',
    start,
    start + 1,
    '\u2019',
    'opening single quote that 0.1 printed as an apostrophe written as the apostrophe'
  )
}

const SIGILS = new Set(['tag', 'mention', 'inline_extension', 'symbol'])

/** U-073: a sigil starts a form only after a character outside the letter-or-number class (C2-I-090). */
function sigil(ctx: Context, node: Node01): void {
  const start = node.pos!.startOffset
  if (start === 0 || ctx.src.charCodeAt(start) === BRACE) return
  const low = ctx.src.charCodeAt(start - 1)
  const from = low >= 0xdc00 && low <= 0xdfff && start > 1 ? start - 2 : start - 1
  if (!isWordCharacter(ctx.src.codePointAt(from)!)) return
  note(ctx, 'U-073', node.pos!.startLine, 'a sigil form directly after a letter or number is text in 0.2')
}

function escapedBrace(src: string, at: number): boolean {
  let count = 0
  for (let before = at - 1; src[before] === '\\'; before--) count++
  return count % 2 === 1
}

function bracedSameKind(ctx: Context, node: Node01): void {
  const { startOffset: start, endOffset: end } = node.pos!
  if (!ctx.src.startsWith('{*', start) || !ctx.src.startsWith('*}', end - 2)) return
  for (const child of node.children ?? []) {
    if (child.type !== 'text' || child.pos === undefined) continue
    for (let at = child.pos.startOffset; at < child.pos.endOffset; at++) {
      if (ctx.src[at] === '*' && !escapedBrace(ctx.src, at)) {
        change(ctx, 'U-274', at, at, '\\', 'bare strong mark kept as text inside the 0.1 braced strong span')
      }
    }
  }
}

function escapeTextSlashes(ctx: Context, node: Node01): boolean {
  if (node.type !== 'text' || node.pos === undefined) return false
  let escaped = false
  for (let at = node.pos.startOffset; at < node.pos.endOffset; at++) {
    if (ctx.src[at] !== '/' || escapedBrace(ctx.src, at)) continue
    change(ctx, 'U-273', at, at, '\\', 'slash kept as text by the 0.1 bare emphasis parse')
    escaped = true
  }
  return escaped
}

function bareSameKind(ctx: Context, visit: Visit): void {
  const node = visit.node
  const { startOffset: start, endOffset: end } = node.pos!
  if (ctx.src[start] !== '/' || ctx.src[end - 1] !== '/') return
  let inside = false
  for (const child of node.children ?? []) inside = escapeTextSlashes(ctx, child) || inside
  if (!inside) return
  const after = visit.siblings[visit.index + 1]
  if (after !== undefined) escapeTextSlashes(ctx, after)
}

function hasUnattachedNeighbors(ctx: Context, visit: Visit, start: number, end: number): boolean {
  const before = visit.siblings[visit.index - 1]
  const after = visit.siblings[visit.index + 1]
  return ctx.src[start - 1] === '{' && ctx.src[end] === '}' && !escapedBrace(ctx.src, start - 1)
    && ctx.src[start - 2] === ' ' && ctx.src[end + 1] === ' '
    && before?.type === 'text' && before.pos?.endOffset === start
    && after?.type === 'text' && after.pos?.startOffset === end
}

function unattachedId(ctx: Context, visit: Visit): void {
  if (visit.parent?.node.type !== 'paragraph') return
  const start = visit.node.pos!.startOffset
  const end = visit.node.pos!.endOffset
  if (!hasUnattachedNeighbors(ctx, visit, start, end)) return
  change(ctx, 'U-275', start - 1, start - 1, '\\', 'unattached id attribute escaped to keep the 0.1 tag text')
}

/** U-072: at a brace the attribute block is tried first (C2-I-043). */
function editorialComment(ctx: Context, node: Node01): void {
  const { startOffset: start, startLine } = node.pos!
  const close = ctx.src.indexOf('}', start)
  if (!ctx.src.startsWith('{#', start) || close < 0 || close >= node.pos!.endOffset - 2) return
  note(ctx, 'U-072', startLine, 'an editorial comment that starts like an id is an attribute block in 0.2')
}

function rawHtml(ctx: Context, node: Node01): void {
  if (node.format !== 'html') return
  if (node.type === 'raw_inline') {
    note(ctx, 'U-077', node.pos!.startLine, 'a raw HTML span is written escaped unless the host sets --raw-html')
  } else {
    note(
      ctx,
      'U-076',
      node.pos!.startLine,
      'a raw HTML block is written as a code block unless the host sets --raw-html'
    )
  }
}

function inlineNode(ctx: Context, visit: Visit): void {
  const node = visit.node
  if (node.pos === undefined) return
  const bare = BARE[node.type]
  if (bare !== undefined) bareSpan(ctx, node, bare)
  else if (node.type === 'strong') { boldItalic(ctx, node); bracedSameKind(ctx, node) }
  else if (node.type === 'emphasis') bareSameKind(ctx, visit)
  else if (node.type === 'substitution') substitution(ctx, node)
  else if (node.type === 'delete') deletionTagName(ctx, node)
  else if (node.type === 'smart_punctuation') demotedQuote(ctx, node)
  else if (node.type === 'critic_comment') editorialComment(ctx, node)
  else if (node.type === 'tag') { sigil(ctx, node); unattachedId(ctx, visit) }
  else if (SIGILS.has(node.type)) sigil(ctx, node)
  else if (node.type === 'raw_inline' || node.type === 'raw_block') rawHtml(ctx, node)
}

export function inline(ctx: Context): void {
  const headings = headingTexts(ctx)
  for (let index = 0; index < ctx.visits.length; index++) {
    inlineNode(ctx, ctx.visits[index]!)
    if (!isUnresolved(ctx, index, headings)) continue
    // 0.1 wrote an unresolved reference as typed, so nothing inside it is a span to respell (U-113).
    const link = ctx.visits[index]!
    while (index + 1 < ctx.visits.length && isInside(ctx.visits[index + 1]!, link)) index++
  }
}

export function unclosedRuns(ctx: Context): void {
  for (const visit of ctx.visits) unclosedRun(ctx, visit)
}

function lineBlockVisibleEnds(ctx: Context): Map<number, number> {
  const ends = new Map<number, number>()
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.pos === undefined || ancestor(visit, 'line_block') === null || Array.isArray(node.children)) continue
    if (node.type === 'non_breaking_space' || node.type === 'hard_break' || node.type === 'comment') continue
    ends.set(node.pos.startLine, Math.max(ends.get(node.pos.startLine) ?? 0, node.pos.endOffset))
  }
  return ends
}

export function lineBlockSpaces(ctx: Context): void {
  const visibleEnds = lineBlockVisibleEnds(ctx)
  let line = 0
  let seenVisible = false
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.pos === undefined || ancestor(visit, 'line_block') === null || Array.isArray(node.children)) continue
    if (node.pos.startLine !== line) { line = node.pos.startLine; seenVisible = false }
    if (node.type === 'non_breaking_space' && seenVisible && ctx.src[node.pos.startOffset] === ' '
      && node.pos.startOffset < (visibleEnds.get(line) ?? 0)) {
      change(ctx, 'U-265', node.pos.startOffset, node.pos.startOffset, '\\', 'interior line block space kept as nonbreaking')
    } else if (node.type !== 'non_breaking_space' && node.type !== 'hard_break' && node.type !== 'comment') {
      seenVisible = true
    }
  }
}
