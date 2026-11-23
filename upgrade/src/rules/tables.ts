// Contract 2.6, 2.9 and 2.10: thematic breaks, tables and captions.
import { change, type Context, note, noteRange, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { lineStart, lineText } from '../source.ts'
import {
  attributeLinesAbove, insideQuotes, isAttributeGap, isBlankInQuotes, isGap, removeAttribute, removeLine, trimmedEnd
} from './lines.ts'

const STAR = 0x2a
const ALIGN_MARKS: Record<string, string> = { left: '<', right: '>', center: '~' }

function isStarRun(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) !== STAR) return false
  }
  return text.length >= 3
}

function isBreakRun(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (!'-_* \t'.includes(text[at]!)) return false
  }
  return true
}

/** U-044, U-045: only a run of three or more `*` is a thematic break (C2-B-159). */
function thematicBreak(ctx: Context, node: Node01): void {
  const { startOffset: start, endOffset: end } = node.pos!
  const text = ctx.src.slice(start, end)
  if (isStarRun(text) || !isBreakRun(text)) return
  const spaced = text.includes(' ') || text.includes('\t')
  change(ctx, spaced ? 'U-045' : 'U-044', start, end, '***', 'thematic break respelled as ***')
}

function cellsOf(row: Node01): Node01[] {
  // A cell that a continuation row formed has no position, and nothing is edited there.
  return Array.isArray(row.cells) ? (row.cells as Node01[]).filter((cell) => cell.pos !== undefined) : []
}

function rowsOf(table: Node01): Node01[] {
  return Array.isArray(table.rows) ? (table.rows as Node01[]) : []
}

/** Makes `cell` a header cell with the alignment `align`, by the mark after its pipe (C2-B-171). */
const ALIGN_STYLES: Record<string, string> = { '<': 'left', '>': 'right', '~': 'center' }

/** Set by the late variant that writes the alignment of a counted head cell as its own style (C2-B-213, C2-H-162). */
let headStyles = false

function headerCell(ctx: Context, id: string, cell: Node01, align: unknown, message: string): void {
  const start = cell.pos!.startOffset
  if (ctx.src[start - 1] !== '|' || ctx.src[start] === '=') return
  const styled = headStyles && id === 'U-058' && ctx.src[start] === '{' && ctx.src[start + 2] === '}'
    ? ALIGN_STYLES[ctx.src[start + 1]!] : undefined
  if (styled !== undefined) {
    change(ctx, id, start, start + 3, `={style="text-align: ${styled};"}`, message)
    return
  }
  const mark = typeof align === 'string' && ALIGN_MARKS[align] !== undefined ? `{${ALIGN_MARKS[align]}}` : ''
  // C2-B-171: the brace block of a cell prefix is glued to the header mark, so the late pass writes `|={>}`.
  const space = ctx.src[start] === ' ' || (ctx.late && ctx.src[start] === '{') ? '' : ' '
  change(ctx, id, start, start, `=${mark}${space}`, message)
}

function isSeparatorLine(text: string): boolean {
  if (!text.includes('-')) return false
  for (let at = 0; at < text.length; at++) {
    if (!'|-: \t>'.includes(text[at]!)) return false
  }
  return true
}

/** U-055: a separator row is a row of cells in 0.2 (C2-B-166); the head is made of header cells (C2-B-178). */
function separatorRow(ctx: Context, table: Node01): void {
  const rows = rowsOf(table)
  const head = rows[0]
  if (!Array.isArray(table.separatorWidths) || head === undefined) return
  const line = head.pos!.endLine + 1
  if (!isSeparatorLine(lineText(ctx.lines, line))) return
  const message = 'separator row removed, its header row written with header cells'
  removeLine(ctx, 'U-055', line, message)
  for (const cell of cellsOf(head)) headerCell(ctx, 'U-055', cell, cell.align, message)
}

/** The length of the glued 0.1 alignment marks at `at`: a horizontal mark or `?`, then an optional vertical mark. */
function gluedMarks(src: string, at: number): number {
  const first = src[at] ?? ''
  const vertical = '^v~'.includes(src[at + 1] ?? '-') ? 1 : 0
  if (first !== '' && '<>~'.includes(first)) return 1 + vertical
  return first === '?' && vertical === 1 ? 2 : 0
}

/**
 * U-056, U-162: the glued marks of a 0.1 cell prefix go into a brace block (C2-B-171, C2-B-182). Only a cell that
 * 0.1 read an alignment for is rewritten, so text that only looks like a mark stays.
 */
function gluedAlignment(ctx: Context, cell: Node01): void {
  if (cell.align === undefined && cell.valign === undefined) return
  const header = cell.header === true && ctx.src[cell.pos!.startOffset] === '='
  const start = cell.pos!.startOffset + (header ? 1 : 0)
  const length = gluedMarks(ctx.src, start)
  if (length === 0) return
  const marks = ctx.src.slice(start, start + length)
  const id = header && length === 1 ? 'U-056' : 'U-162'
  change(ctx, id, start, start + length, `{${marks}}`, 'glued alignment mark put in braces')
}

const VALIGN_MARKS: Record<string, string> = { top: '^', middle: '~', bottom: 'v' }

/** The braced 0.2 marks of the alignment `align` and `valign`, `?` in place of an absent horizontal mark. */
function bracedMarks(align: unknown, valign: unknown): string {
  const horizontal = typeof align === 'string' ? ALIGN_MARKS[align] ?? '' : ''
  const vertical = typeof valign === 'string' ? VALIGN_MARKS[valign] ?? '' : ''
  if (vertical === '') return horizontal === '' ? '' : `{${horizontal}}`
  return `{${horizontal === '' ? '?' : horizontal}${vertical}}`
}

/**
 * U-269: in 0.1 the alignment block of a span mark that joins in the head set the column it covers (C2-B-174);
 * in 0.2 it sets nothing. The marks move to each cell of that column below the head that has none of its own.
 */
function joinedMarks(ctx: Context, table: Node01): void {
  const rows = rowsOf(table)
  let head = 0
  while (head < rows.length && isHeaderRow(rows[head]!)) head++
  for (const row of rows.slice(0, head)) {
    const cells = Array.isArray(row.cells) ? (row.cells as Node01[]) : []
    cells.forEach((cell, column) => {
      if (cell.span !== 'colspan' || cell.pos === undefined) return
      const marks = bracedMarks(cell.align, cell.valign)
      const open = cell.pos.startOffset + (ctx.src[cell.pos.startOffset] === '=' ? 1 : 0)
      const close = ctx.src.indexOf('}', open)
      if (marks === '' || ctx.src[open] !== '{' || close < 0 || close >= cell.pos.endOffset) return
      const message = 'alignment of a joining span mark moved to the cells it covers'
      change(ctx, 'U-269', open, close + 1, '', message)
      for (const below of rows.slice(head)) coveredCell(ctx, below, column, cell, message)
    })
  }
}

/** U-269: a covered cell takes the marks on each axis it has none of its own on, into its own brace block. */
function coveredCell(ctx: Context, row: Node01, column: number, span: Node01, message: string): void {
  const cell = Array.isArray(row.cells) ? (row.cells as Node01[])[column] : undefined
  if (cell?.pos === undefined || ctx.src[cell.pos.startOffset - 1] !== '|') return
  const start = cell.pos.startOffset
  const marks = bracedMarks(cell.align ?? span.align, cell.valign ?? span.valign)
  if (cell.align === undefined && cell.valign === undefined) {
    if (ctx.src[start] !== '{') change(ctx, 'U-269', start, start, marks, message)
    return
  }
  // A cell with marks of its own on one axis: its brace block takes the other one too.
  const own = ctx.src[start] === '{' ? gluedMarks(ctx.src, start + 1) : 0
  if (own > 0 && marks !== '') change(ctx, 'U-269', start + 1, start + 1 + own, marks.slice(1, -1), message)
}


/** U-057: an escaped last pipe is no separator in 0.2 (C2-B-166). */
function escapedLastPipe(ctx: Context, row: Node01): void {
  const end = trimmedEnd(ctx, row.pos!.endLine)
  if (!ctx.src.startsWith('\\|', end - 2) || ctx.src[end - 3] === '\\') return
  change(ctx, 'U-057', end, end, ' |', 'row closed with a pipe after its escaped pipe')
}

function keyValue(node: Node01, key: string): string | undefined {
  const values = node.attrs?.keyValues
  if (typeof values !== 'object' || values === null) return undefined
  const value = (values as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function isHeaderRow(row: Node01): boolean {
  const cells = cellsOf(row)
  return cells.length > 0 && cells.every((cell) => cell.header === true)
}

/** Whether `table` carries another row key: 0.1 then applies none of them. */
function otherRowKeys(table: Node01): boolean {
  const values = table.attrs?.keyValues
  if (typeof values !== 'object' || values === null) return false
  return Object.keys(values).some((key) => key !== 'header-rows' && key.includes('rows'))
}

/** U-058: `header-rows` has no effect on a pipe table (C2-B-186). */
function headerRows(ctx: Context, table: Node01): void {
  const count = Number.parseInt(keyValue(table, 'header-rows') ?? '', 10)
  if (!(count > 0) || table.sourceFormat !== undefined || otherRowKeys(table)) return
  const rows = rowsOf(table)
  // C2-B-174, C2-H-010, C2-H-056: a span from the body into the head has no spelling, so U-060 reports it.
  if (count < rows.length && cellsOf(rows[count]!).some((cell) => cell.span === 'rowspan')) {
    note(ctx, 'U-060', rows[count - 1]!.pos!.startLine, 'a row span from the body into the counted head does not form in 0.2')
    return
  }
  const message = 'header-rows removed, the counted rows written with header cells'
  const lines = attributeLinesAbove(ctx, table.pos!.startLine)
  if (!lines.some((line) => removeAttribute(ctx, 'U-058', line, (token) => token.startsWith('header-rows='), message))) return
  for (const row of rowsOf(table).slice(0, count)) {
    for (const cell of cellsOf(row)) headerCell(ctx, 'U-058', cell, undefined, message)
  }
}

/** U-059, U-060: table shapes with no 0.2 spelling. */
function tableReports(ctx: Context, table: Node01): void {
  const rows = rowsOf(table)
  if (keyValue(table, 'footer-rows') !== undefined && rows.every(isHeaderRow)) {
    note(ctx, 'U-059', table.pos!.startLine, 'footer-rows on a table of header rows: a head row is never a footer row in 0.2')
  }
  for (let index = 1; index < rows.length; index++) {
    const spans = cellsOf(rows[index]!).some((cell) => ctx.src.slice(cell.pos!.startOffset, cell.pos!.endOffset).trim() === '^')
    if (spans && isHeaderRow(rows[index - 1]!) && !isHeaderRow(rows[index]!)) {
      note(ctx, 'U-060', rows[index]!.pos!.startLine, 'a row span into the head does not form in 0.2')
    }
  }
}

function blockedSpanMarkers(ctx: Context, table: Node01): void {
  rowsOf(table).forEach((row, rowIndex) => {
    // The column counts the cells a continuation row formed too, which have no position.
    const all = !Array.isArray(row.cells) ? [] : ctx.repairs === true ? row.cells as Node01[] : cellsOf(row)
    all.forEach((cell, column) => {
      if (cell.pos === undefined || cell.span !== 'rowspan' && cell.span !== 'colspan') return
      const text = ctx.src.slice(cell.pos!.startOffset, cell.pos!.endOffset)
      const content = text.trim().replace(/^=/u, '').trim()
      const blockedCaret = content === '^' && cell.span === 'rowspan' && rowIndex === 0
      const blockedLeft = content === '<' && cell.span === 'colspan' && column === 0
      if (!blockedCaret && !blockedLeft) return
      const at = cell.pos!.startOffset + text.indexOf(content)
      change(ctx, 'U-259', at, at + 1, '', 'blocked table span marker removed to retain the empty 0.1 cell')
    })
  })
}

function table(ctx: Context, node: Node01): void {
  separatorRow(ctx, node)
  joinedMarks(ctx, node)
  headerRows(ctx, node)
  tableReports(ctx, node)
  blockedSpanMarkers(ctx, node)
  for (const row of rowsOf(node)) {
    if (row.pos === undefined) continue
    escapedLastPipe(ctx, row)
    for (const cell of cellsOf(row)) gluedAlignment(ctx, cell)
  }
}

/** U-063: after a blank line a caption line is text in 0.2 (C2-B-149). */
function captionAfterBlank(ctx: Context, node: Node01): void {
  const caption = node.caption
  if (!Array.isArray(caption) || caption.length === 0) return
  const first = (caption[0] as Node01).pos
  if (first === undefined) return
  for (let line = first.startLine - 1; line > 1 && isBlankInQuotes(lineText(ctx.lines, line)); line--) {
    removeLine(ctx, 'U-063', line, 'blank line above the caption removed')
  }
}

/** U-061: a fence the `table` attribute marks is always a table in 0.2 (C2-B-180). */
function delimited(ctx: Context, node: Node01): void {
  if (node.attrs === undefined || keyValue(node, 'table') === undefined) return
  // The range starts at the attribute line, which 0.1 also attached across blank lines.
  let line = node.pos!.startLine
  for (let at = line - 1; isGap(ctx, at); at--) {
    if (isAttributeGap(ctx, at)) line = at
    else if (!isBlankInQuotes(lineText(ctx.lines, at))) break
  }
  noteRange(ctx, 'U-061', line, lineStart(ctx.lines, line), node.pos!.endOffset,
    'a delimited table that 0.1 left a code block is a table in 0.2')
}

function visitNode(ctx: Context, visit: Visit): void {
  const node = visit.node
  if (node.pos === undefined) return
  if (node.type === 'thematic_break') thematicBreak(ctx, node)
  else if (node.type === 'table') table(ctx, node)
  else if (node.type === 'code_block') delimited(ctx, node)
  captionAfterBlank(ctx, node)
}

export function tables(ctx: Context): void {
  for (const visit of ctx.visits) visitNode(ctx, visit)
}

/** The late form of `tables` that keeps a counted head cell's alignment on that cell alone. */
export function tablesHeadStyles(ctx: Context): void {
  headStyles = true
  try { tables(ctx) } finally { headStyles = false }
}

/** U-011: 0.2.0 expands no include (C2-H-133), so every directive is reported. */
export function includes(ctx: Context): void {
  for (const leaf of ctx.blocks.leaves) {
    if (leaf.node.type !== 'paragraph') continue
    for (let line = leaf.node.pos!.startLine; line <= leaf.node.pos!.endLine; line++) {
      const text = insideQuotes(lineText(ctx.lines, line)).trim()
      if (text.startsWith('{{') && text.endsWith('}}') && lineStart(ctx.lines, line) >= 0) {
        note(ctx, 'U-011', line, 'an include directive is not expanded by 0.2.0 and renders as text')
      }
    }
  }
}
