// Contract 3: text that 0.1 left text and 0.2 reads as a construct.
import { ancestor } from '../blocks.ts'
import { change, type Context, type Visit } from '../context.ts'
import { type Node01, probe02 } from '../engines.ts'
import { indentOf, isBlank, lineEnd, lineStart, lineText } from '../source.ts'
import { isGap, trimmedEnd } from './lines.ts'
import { headingTexts, plainText } from './references.ts'

const EQUALS = 0x3d
const HEADING_MAX = 6

/** U-101: one to six `=`, a space and content is a heading in 0.2 (C2-B-151). */
function equalsStart(ctx: Context, paragraph: Node01): void {
  const start = paragraph.pos!.startOffset
  let at = start
  while (ctx.src.charCodeAt(at) === EQUALS) at++
  const run = at - start
  if (run === 0 || run > HEADING_MAX || ctx.src[at] !== ' ' || at + 1 >= lineEnd(ctx.lines, paragraph.pos!.startLine)) return
  change(ctx, 'U-101', start, start, '\\', '= at the start of a block escaped, it would open a heading in 0.2')
}

function isLetter(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a)
}

/** Offset of the delimiter of a letter marker that starts at `start`, or -1. */
function letterMarker(ctx: Context, start: number, end: number): number {
  let at = start
  while (at < end && isLetter(ctx.src.charCodeAt(at))) at++
  if (at === start || at + 2 >= end || (ctx.src[at] !== '.' && ctx.src[at] !== ')')) return -1
  return ctx.src[at + 1] === ' ' ? at : -1
}

/** U-103: a letter or roman numeral with one space is an ordered marker in 0.2 (C2-B-036, C2-B-040). */
function letterLine(ctx: Context, start: number, line: number): void {
  const end = lineEnd(ctx.lines, line)
  const at = letterMarker(ctx, start, end)
  // The 0.2 engine says whether the word is a marker: a roman numeral is one, `mix.` is not.
  if (at < 0 || !probe02(ctx.src.slice(start, end)).startsWith('<ol')) return
  change(ctx, 'U-103', at, at, '\\', 'letter marker escaped, it would open an ordered list in 0.2')
}

function inBody(visit: Visit, ctx: Context): boolean {
  return ancestor(visit, 'list_item') !== null || ancestor(visit, 'definition_list') !== null || visit.siblings !== ctx.doc.children
}

function letterMarkers(ctx: Context, visit: Visit): void {
  const pos = visit.node.pos!
  letterLine(ctx, pos.startOffset, pos.startLine)
  // C2-B-015: inside an item, a description or a footnote body a later marker line interrupts.
  if (!inBody(visit, ctx)) return
  for (let line = pos.startLine + 1; line <= pos.endLine; line++) {
    letterLine(ctx, lineStart(ctx.lines, line) + indentOf(lineText(ctx.lines, line)), line)
  }
}

/** U-108: a row attribute may stand one space after the closing pipe in 0.2 (C2-B-167). */
function rowAttribute(ctx: Context, paragraph: Node01): void {
  for (let line = paragraph.pos!.startLine; line <= paragraph.pos!.endLine; line++) {
    const text = lineText(ctx.lines, line)
    const end = trimmedEnd(ctx, line)
    const brace = ctx.src.lastIndexOf('{', end)
    if (!text.trimStart().startsWith('|') || ctx.src[end - 1] !== '}' || brace < lineStart(ctx.lines, line)) continue
    if (ctx.src.startsWith('| ', brace - 2) && ctx.src[brace - 3] !== '\\') {
      change(ctx, 'U-108', brace, brace, '\\', 'brace after the closing pipe escaped, it would be a row attribute in 0.2')
    }
  }
}

/** The leaf on the nearest line above `line` that is not blank. */
function leafAbove(ctx: Context, line: number): Visit | null {
  let at = line - 1
  while (at >= 1 && isBlank(lineText(ctx.lines, at))) at--
  return at >= 1 ? (ctx.blocks.leaf[at] ?? null) : null
}

/**
 * U-109: with no paragraph open, a line belongs to the item or footnote body whose marker it is
 * indented past (C2-B-025); 0.1 kept it only from the content column on. A block of the document
 * that stands indented under an item or a footnote moves to column 0.
 */
function shortIndent(ctx: Context, visit: Visit): void {
  const pos = visit.node.pos!
  const indent = indentOf(lineText(ctx.lines, pos.startLine))
  if (indent === 0 || visit.parent!.node !== ctx.doc || visit.siblings !== ctx.doc.children) return
  // Under a list of the document, also an empty one, or under the body of a footnote.
  const list = visit.index > 0 && visit.siblings[visit.index - 1]!.type === 'list'
  const above = leafAbove(ctx, pos.startLine)
  const body = above !== null && above.siblings !== ctx.doc.children && above.parent!.node === ctx.doc
  if (!list && !body) return
  const message = 'block moved to column 0, where it stays outside the item or footnote above'
  // The later lines of a paragraph are lazy lines wherever they stand; another block moves whole.
  const last = visit.node.type === 'paragraph' ? pos.startLine : pos.endLine
  for (let line = pos.startLine; line <= last; line++) {
    const cut = Math.min(indent, indentOf(lineText(ctx.lines, line)))
    if (cut > 0) change(ctx, 'U-109', lineStart(ctx.lines, line), lineStart(ctx.lines, line) + cut, '', message)
  }
}

/** U-102: a line indented past the heading marker continues the heading in 0.2 (C2-B-154). */
function underHeading(ctx: Context, visit: Visit): void {
  const pos = visit.node.pos!
  const next = pos.endLine + 1
  const below = ctx.blocks.leaf[next]
  if (below === null || below === undefined || below.node.pos!.startLine !== next || isGap(ctx, next)) return
  const column = pos.startColumn - 1
  const indent = indentOf(lineText(ctx.lines, next))
  if (indent <= column) return
  const at = lineStart(ctx.lines, next)
  change(ctx, 'U-102', at + column, at + indent, '', 'line under the heading moved to the column of the heading marker')
}

const INLINE_TEXT = new Set(['text', 'soft_break', 'escaped_text', 'non_breaking_space'])

/** U-113: an unresolved reference renders its children in 0.2 (C2-I-085); 0.1 wrote it as typed. */
function markupInside(ctx: Context, link: Node01): void {
  for (const child of link.children ?? []) {
    if (INLINE_TEXT.has(child.type) || child.pos === undefined) continue
    const { startOffset: start, endOffset: end } = child.pos
    const message = 'markup inside an unresolved reference escaped, 0.1 wrote it as typed'
    change(ctx, 'U-113', start, start, '\\', message)
    const last = ctx.src[end - 1]!
    if (end - start > 1 && last === ctx.src[start] && !'[]{}'.includes(last)) change(ctx, 'U-113', end - 1, end - 1, '\\', message)
  }
}

/** U-110 to U-113: references 0.1 left text and 0.2 resolves or renders. */
function reference(ctx: Context, index: number, headings: Set<string>): void {
  const link = ctx.visits[index]!.node
  const ref = link.ref
  const raw = link.rawRef
  if (link.href !== '' || typeof ref !== 'string' || typeof raw !== 'string') return
  const { startOffset: start, endOffset: end } = link.pos!
  const collapsed = raw.endsWith('[]')
  if (ref.startsWith('^')) {
    // C2-I-078: `[^n]` behind a bracket pair is a footnote reference.
    change(ctx, 'U-112', end - ref.length - 2, end - ref.length - 2, '\\', 'label that starts with a caret escaped, it would be a footnote reference in 0.2')
  } else if (ref.includes('\n')) {
    // C2-I-080: a label may wrap in 0.2.
    change(ctx, 'U-111', start, start, '\\', 'reference with a wrapped label escaped, the label folds and may resolve in 0.2')
    markupInside(ctx, link)
  } else if (headings.has(collapsed ? plainText(ctx.visits, index) : ref)) {
    // C2-I-081: the heading lookup applies to the full form too.
    if (!collapsed) change(ctx, 'U-110', start, start, '\\', 'full reference to a heading escaped, it would link in 0.2')
  } else {
    markupInside(ctx, link)
  }
}

/**
 * U-104, U-105: a fence opener that 0.1 read as paragraph text, because of its title, opens its
 * block in 0.2 (C2-B-122). A backslash keeps a colon line text; a backtick line takes an empty
 * braced comment, because a backslash would leave a code span open on a shorter run.
 */
function fenceOpenerAsText(ctx: Context, paragraph: Node01): void {
  const start = paragraph.pos!.startOffset
  const colon = ctx.src.startsWith(':::', start)
  if (!colon && !ctx.src.startsWith('```', start)) return
  const line = ctx.src.slice(start, lineEnd(ctx.lines, paragraph.pos!.startLine))
  // The 0.2 engine says whether the line opens a block there.
  if (probe02(line + '\nx\n').startsWith('<p>')) return
  if (colon) change(ctx, 'U-104', start, start, '\\', 'fence opener that 0.1 read as text escaped')
  else change(ctx, 'U-105', start, start, '{%%}', 'fence opener that 0.1 read as text kept from opening by an empty braced comment')
}

const SPAN_MARKS = '*/_~=^,'

/** The delimiter of the bare span `node`, or an empty string. */
function bareMark(ctx: Context, node: Node01): string {
  const mark = ctx.src[node.pos!.startOffset]!
  return node.pos !== undefined && SPAN_MARKS.includes(mark) && ctx.src[node.pos.endOffset - 1] === mark ? mark : ''
}

/**
 * U-070: bare and braced spans share one stack in 0.2 and the first pair closed wins (C2-I-059),
 * so the delimiter of an outer bare span is escaped inside a braced span it holds.
 */
function delimiterInBraces(ctx: Context, visit: Visit): void {
  const { startOffset: start, endOffset: end } = visit.node.pos!
  if (visit.node.value !== ctx.src.slice(start, end)) return
  let braced = false
  let marks = ''
  for (let at = visit.parent; at !== null && at.node.pos !== undefined && at.node.type !== 'paragraph'; at = at.parent) {
    if (ctx.src[at.node.pos.startOffset] === '{') braced = true
    else if (braced) marks += bareMark(ctx, at.node)
  }
  if (marks === '') return
  for (let at = start; at < end; at++) {
    if (marks.includes(ctx.src[at]!)) change(ctx, 'U-070', at, at, '\\', 'delimiter of an outer span escaped inside a braced span, where it would close the outer span in 0.2')
  }
}

/** The blocks U-109 moves: a list has its own column rules (U-023) and a definition its own (U-039). */
const SHORT_INDENT = new Set(['paragraph', 'block_quote', 'heading', 'code_block', 'table', 'thematic_break'])

export function escapes(ctx: Context): void {
  const headings = headingTexts(ctx)
  for (let index = 0; index < ctx.visits.length; index++) {
    const visit = ctx.visits[index]!
    const node = visit.node
    if (node.pos === undefined) continue
    if (node.type === 'link') reference(ctx, index, headings)
    else if (node.type === 'heading') underHeading(ctx, visit)
    else if (node.type === 'text') delimiterInBraces(ctx, visit)
    else if (node.type === 'paragraph' && visit.parent !== null && ctx.blocks.leaf[node.pos.startLine] === visit) {
      equalsStart(ctx, node)
      fenceOpenerAsText(ctx, node)
      letterMarkers(ctx, visit)
      rowAttribute(ctx, node)
    }
    if (visit.parent !== null && SHORT_INDENT.has(node.type)) shortIndent(ctx, visit)
  }
}
