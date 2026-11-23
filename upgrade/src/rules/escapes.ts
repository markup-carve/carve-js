// Contract 3: text that 0.1 left text and 0.2 reads as a construct.
import { ancestor, quotesOf } from '../blocks.ts'
import { foldLabel } from '../../../src/ast-attributes.ts'
import { change, type Context, type Visit } from '../context.ts'
import { type Node01, probe02 } from '../engines.ts'
import { indentOf, isBlank, lineEnd, lineStart, lineText } from '../source.ts'
import { quotePrefix } from './blank-lines.ts'
import { insideQuotes, isGap, trimmedEnd } from './lines.ts'
import { headingTexts, plainText } from './references.ts'

const EQUALS = 0x3d
const HEADING_MAX = 6

/** U-101: one to six `=`, a space and content is a heading in 0.2 (C2-B-151). */
function equalsStart(ctx: Context, paragraph: Node01): void {
  const start = paragraph.pos!.startOffset
  let at = start
  while (ctx.src.charCodeAt(at) === EQUALS) at++
  const run = at - start
  if (run === 0 || run > HEADING_MAX || ctx.src[at] !== ' ' || at + 1 >= lineEnd(ctx.lines, paragraph.pos!.startLine))
    return
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
  return (
    ancestor(visit, 'list_item') !== null ||
    ancestor(visit, 'definition_list') !== null ||
    visit.siblings !== ctx.doc.children
  )
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
    if (!text.trimStart().startsWith('|') || ctx.src[end - 1] !== '}') continue
    const start = lineStart(ctx.lines, line)
    const localBrace = ctx.src.slice(start, end).lastIndexOf('{')
    if (localBrace < 0) continue
    const brace = start + localBrace
    if (ctx.src.startsWith('| ', brace - 2) && ctx.src[brace - 3] !== '\\') {
      change(
        ctx,
        'U-108',
        brace,
        brace,
        '\\',
        'brace after the closing pipe escaped, it would be a row attribute in 0.2'
      )
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
/** Whether the leaf above `line` stands in the body of a footnote. */
function underNote(ctx: Context, line: number): boolean {
  let above = leafAbove(ctx, line)
  // The repairs also read a footnote body whose last block is a container.
  if (ctx.repairs === true) while (above?.parent != null && above.parent.node !== ctx.doc) above = above.parent
  return above !== null && above.siblings !== ctx.doc.children && above.parent!.node === ctx.doc
}

function shortIndent(ctx: Context, visit: Visit): void {
  const pos = visit.node.pos!
  const indent = indentOf(lineText(ctx.lines, pos.startLine))
  if (visit.parent!.node !== ctx.doc) {
    nestedShortIndent(ctx, visit)
    return
  }
  if (indent === 0 || visit.parent!.node !== ctx.doc || visit.siblings !== ctx.doc.children) return
  // Under a list of the document, also an empty one, or under the body of a footnote.
  const list = visit.index > 0 && visit.siblings[visit.index - 1]!.type === 'list'
  if (!list && !underNote(ctx, pos.startLine)) return
  const message = 'block moved to column 0, where it stays outside the item or footnote above'
  // The later lines of a paragraph are lazy lines wherever they stand; another block moves whole.
  const last = visit.node.type === 'paragraph' ? pos.startLine : pos.endLine
  for (let line = pos.startLine; line <= last; line++) {
    const cut = Math.min(indent, indentOf(lineText(ctx.lines, line)))
    if (cut > 0) change(ctx, 'U-109', lineStart(ctx.lines, line), lineStart(ctx.lines, line) + cut, '', message)
  }
}

const NESTED_SHORT_INDENT = new Set(['paragraph', 'block_quote'])

/** The first item of the list just before `visit` that starts on an earlier line, or null. */
function listAbove(ctx: Context, visit: Visit): Node01 | null {
  // Description bodies, tables and fences after a nested list have their own rows (U-228, U-247, U-122).
  if (!NESTED_SHORT_INDENT.has(visit.node.type) || visit.parent!.node.type === 'definition_list') return null
  const list = visit.index > 0 ? visit.siblings[visit.index - 1]! : undefined
  const item = list?.type === 'list' ? list.items?.[0] : undefined
  if (item?.pos === undefined || item.pos.startLine >= visit.node.pos!.startLine) return null
  // A block a `+` line attaches is U-016's.
  return insideQuotes(lineText(ctx.lines, visit.node.pos!.startLine - 1)).trim() === '+' ? null : item
}

/** U-237: a block that 0.1 put after a nested list moves to that list's marker column (C2-B-015, C2-B-076). */
function nestedShortIndent(ctx: Context, visit: Visit): void {
  const item = listAbove(ctx, visit)
  if (item === null) return
  const itemStart = lineStart(ctx.lines, item.pos!.startLine)
  const itemLine = lineText(ctx.lines, item.pos!.startLine)
  const marker = item.pos!.startOffset - itemStart + indentOf(itemLine.slice(item.pos!.startOffset - itemStart))
  const pos = visit.node.pos!
  const first = lineText(ctx.lines, pos.startLine)
  const depth = quotesOf(visit).length
  const prefix = quotePrefix(first, depth).length
  if (prefix !== quotePrefix(itemLine, depth).length || prefix > marker) return
  const indent = prefix + indentOf(first.slice(prefix))
  if (indent <= marker) return
  const message = 'the follower was moved to its outer item content column'
  const last = visit.node.type === 'paragraph' ? pos.startLine : pos.endLine
  for (let line = pos.startLine; line <= last; line++) {
    const own = indentOf(lineText(ctx.lines, line).slice(prefix))
    const cut = Math.min(indent - marker, own)
    const at = lineStart(ctx.lines, line) + prefix + own
    if (cut > 0) change(ctx, 'U-237', at - cut, at, '', message)
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
function markupInside(ctx: Context, link: Node01, escaped = false): void {
  let outer = escaped
  for (const child of link.children ?? []) {
    if (INLINE_TEXT.has(child.type) || child.pos === undefined) continue
    const { startOffset: start, endOffset: end } = child.pos
    const message = 'markup inside an unresolved reference escaped, 0.1 wrote it as typed'
    // With the inner `[` escaped, the reference's own `[` would pair with the inner `]` in 0.2.
    if (!outer && ctx.src[start] === '[' && ctx.src[link.pos!.startOffset] === '[') {
      outer = true
      change(ctx, 'U-113', link.pos!.startOffset, link.pos!.startOffset, '\\', message)
    }
    change(ctx, 'U-113', start, start, '\\', message)
    const last = ctx.src[end - 1]!
    if (end - start > 1 && last === ctx.src[start] && !'[]{}'.includes(last))
      change(ctx, 'U-113', end - 1, end - 1, '\\', message)
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
    change(
      ctx,
      'U-112',
      end - ref.length - 2,
      end - ref.length - 2,
      '\\',
      'label that starts with a caret escaped, it would be a footnote reference in 0.2'
    )
  } else if (ref.includes('\n')) {
    // C2-I-080: a label may wrap in 0.2.
    change(
      ctx,
      'U-111',
      start,
      start,
      '\\',
      'reference with a wrapped label escaped, the label folds and may resolve in 0.2'
    )
    if (ctx.doc.children?.some((node) => node.type === 'link_reference_definition' && node.label === foldLabel(ref))) {
      change(
        ctx,
        'U-111',
        end - ref.length - 2,
        end - ref.length - 2,
        '\\',
        'the wrapped label escaped because it would become a shortcut after the first escape'
      )
    }
    // U-111 already escaped the reference's own bracket.
    markupInside(ctx, link, true)
  } else if (headings.has(collapsed ? plainText(ctx.visits, index) : ref)) {
    // C2-I-081: the heading lookup applies to the full form too.
    if (!collapsed)
      change(ctx, 'U-110', start, start, '\\', 'full reference to a heading escaped, it would link in 0.2')
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
  else
    change(
      ctx,
      'U-105',
      start,
      start,
      '{%%}',
      'fence opener that 0.1 read as text kept from opening by an empty braced comment'
    )
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
  for (
    let at = visit.parent;
    at !== null && at.node.pos !== undefined && at.node.type !== 'paragraph';
    at = at.parent
  ) {
    if (ctx.src[at.node.pos.startOffset] === '{') braced = true
    else if (braced) marks += bareMark(ctx, at.node)
  }
  if (marks === '') return
  for (let at = start; at < end; at++) {
    if (marks.includes(ctx.src[at]!))
      change(
        ctx,
        'U-070',
        at,
        at,
        '\\',
        'delimiter of an outer span escaped inside a braced span, where it would close the outer span in 0.2'
      )
  }
}

const HYPHEN = 0x2d
const BRACED_EN_DASH = '{--}'

/**
 * U-115: a run of two or more hyphens is dashes wherever it stands in 0.2 (C2-I-111). 0.1 kept a run
 * in the place of a command-line flag as typed, so every second hyphen of a run in text is escaped.
 * The start of a text node behind a smart quote is wrong in the 0.1 tree; its end is right.
 */
function flagRuns(ctx: Context, node: Node01): void {
  const value = node.value
  if (typeof value !== 'string' || !value.includes('--')) return
  const end = node.pos!.endOffset
  const start = end - value.length
  if (start < 0 || ctx.src.slice(start, end) !== value || onDirectiveLine(ctx, node)) return
  for (let at = 0; at < value.length;) {
    let run = at
    while (run < value.length && value.charCodeAt(run) === HYPHEN) run++
    for (let hyphen = at + 1; hyphen < run; hyphen += 2) {
      change(
        ctx,
        'U-115',
        start + hyphen,
        start + hyphen,
        '\\',
        'hyphen of a run 0.1 kept as typed escaped, the run would be a dash in 0.2'
      )
    }
    at = run > at ? run : at + 1
  }
}

/** U-011: 0.2 writes a line that reads as an include directive as typed, so its hyphens need no escape. */
function onDirectiveLine(ctx: Context, node: Node01): boolean {
  const text = insideQuotes(lineText(ctx.lines, node.pos!.startLine)).trim()
  return text.startsWith('{{') && text.endsWith('}}')
}

/**
 * U-115: `{--}` is no en dash in 0.2 (C2-I-111); two bare hyphens are. A single hyphen beside them
 * would join their run, so it is escaped.
 */
function bracedEnDash(ctx: Context, node: Node01): void {
  const { startOffset: start, endOffset: end } = node.pos!
  // A run of hyphens behind it is a dash of its own in 0.1, which no spelling of the pair keeps apart.
  if (ctx.src.slice(start, end) !== BRACED_EN_DASH || ctx.src.startsWith('--', end)) return
  const message = 'braced en dash written as two hyphens, 0.2 has no braced form'
  if (ctx.src.charCodeAt(start - 1) === HYPHEN && ctx.src[start - 2] !== '\\')
    change(ctx, 'U-115', start - 1, start - 1, '\\', message)
  change(ctx, 'U-115', start, end, ctx.src.charCodeAt(end) === HYPHEN ? '--\\' : '--', message)
}

/** U-115: the cells of a delimited table are not read as inline content in 0.2, so they take no escape. */
function inDelimitedTable(ctx: Context, visit: Visit): boolean {
  const table = ancestor(visit, 'table')
  return table?.node.pos !== undefined && ctx.src[table.node.pos.startOffset] !== '|'
}

/** The blocks U-109 moves: a list has its own column rules (U-023) and a definition its own (U-039). */
const SHORT_INDENT = new Set(['paragraph', 'block_quote', 'heading', 'code_block', 'table', 'thematic_break'])

function paragraphEscapes(ctx: Context, visit: Visit): void {
  const node = visit.node
  if (node.type !== 'paragraph' || visit.parent === null || node.pos === undefined) return
  if (ctx.blocks.leaf[node.pos.startLine] !== visit) return
  equalsStart(ctx, node)
  fenceOpenerAsText(ctx, node)
  letterMarkers(ctx, visit)
  rowAttribute(ctx, node)
}

export function escapes(ctx: Context): void {
  const headings = headingTexts(ctx)
  for (let index = 0; index < ctx.visits.length; index++) {
    const visit = ctx.visits[index]!
    const node = visit.node
    if (node.pos === undefined) continue
    if (node.type === 'link') reference(ctx, index, headings)
    else if (node.type === 'heading') underHeading(ctx, visit)
    else if (node.type === 'text') {
      delimiterInBraces(ctx, visit)
      if (!inDelimitedTable(ctx, visit)) flagRuns(ctx, node)
    } else if (node.type === 'smart_punctuation') bracedEnDash(ctx, node)
    else if (node.type === 'paragraph') paragraphEscapes(ctx, visit)
    if (visit.parent !== null && SHORT_INDENT.has(node.type)) shortIndent(ctx, visit)
  }
}
