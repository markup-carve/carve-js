// Contract 2.6, 2.9 and 2.10: thematic breaks, tables and captions.
import { change, type Context, note, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { lineStart, lineText } from '../source.ts'
import { attributeLinesAbove, insideQuotes, isBlankInQuotes, removeAttribute, removeLine, trimmedEnd } from './lines.ts'

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
function headerCell(ctx: Context, id: string, cell: Node01, align: unknown, message: string): void {
  const start = cell.pos!.startOffset
  if (ctx.src[start - 1] !== '|' || ctx.src[start] === '=') return
  const mark = typeof align === 'string' && ALIGN_MARKS[align] !== undefined ? `{${ALIGN_MARKS[align]}}` : ''
  const space = ctx.src[start] === ' ' ? '' : ' '
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

/** U-056: a cell prefix is `|=`, a glued brace block and a space (C2-B-171). */
function gluedAlignment(ctx: Context, cell: Node01): void {
  const start = cell.pos!.startOffset
  const mark = ctx.src[start + 1]
  if (ctx.src[start] !== '=' || mark === undefined || !'<>~'.includes(mark)) return
  change(ctx, 'U-056', start + 1, start + 2, `{${mark}}`, 'glued alignment mark put in braces')
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

function table(ctx: Context, node: Node01): void {
  separatorRow(ctx, node)
  headerRows(ctx, node)
  tableReports(ctx, node)
  for (const row of rowsOf(node)) {
    if (row.pos === undefined) continue
    escapedLastPipe(ctx, row)
    for (const cell of cellsOf(row)) {
      if (cell.header === true) gluedAlignment(ctx, cell)
    }
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
  if (node.attrs !== undefined && keyValue(node, 'table') !== undefined) {
    note(ctx, 'U-061', node.pos!.startLine, 'a delimited table that 0.1 left a code block is a table in 0.2')
  }
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
