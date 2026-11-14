// Tables as Carve source (C2-W-061 to C2-W-068, C2-W-118): a pipe table, with the continuation
// rows the sidecar records, or a delimited table.
import {
  childNodes, type CommentNode, type TableBodyNode, type TableCellNode, type TableColumnNode, type TableNode, type TableRowNode,
} from './ast.ts'
import { type BlockParts, braceBlock } from './write-attributes.ts'
import { IN_CELL, writeInlines } from './write-inline.ts'
import { emit, lose, type Writer } from './write-state.ts'
import { type Wrap } from './layout.ts'
import { trimSpaces } from './source.ts'
import { displayWidth } from './width.ts'

const ALIGN_MARKS = new Map([['left', '<'], ['right', '>'], ['center', '~']])
const SPAN_MARKS = new Map([['rowspan', '^'], ['colspan', '<']])
const MIN_RUN = 3

/** One row as written: per line, the segment of each cell (C2-W-118), and the row attribute. */
interface WrittenRow {
  lines: string[][]
  attribute: string
}

/** A group of a table, or a comment between its groups. */
type TableEntry = TableNode['children'][number]

/** A row of a group, or a comment between its rows. */
type RowEntry = TableRowNode | CommentNode

function rowsOf(table: TableNode, type: 'table_head' | 'table_body' | 'table_foot'): TableRowNode[] {
  const rows: TableRowNode[] = []
  for (const group of table.children) {
    if (group.type === 'comment' || group.type !== type) continue
    for (const row of group.children) if (row.type === 'table_row') rows.push(row)
  }
  return rows
}

const MAX_DIGITS = 17

/** C2-B-212: the entry of `widths` that reads back as `width`, a share of the table width: the shortest percentage. */
function percentage(width: number): string {
  for (let digits = 1; digits < MAX_DIGITS; digits++) {
    const text = String(Number((width * 100).toPrecision(digits)))
    if (Number(text) / 100 === width) return text
  }
  return String(width * 100)
}

function columnEntry(column: TableColumnNode, field: 'align' | 'width'): string {
  if (field === 'align') return column.align ?? ''
  const width = column.width
  return width === undefined ? '' : percentage(width)
}

/** The value of `aligns` or `widths`: one entry per column up to the last column that has one (C2-B-211, C2-B-212). */
function columnList(table: TableNode, field: 'align' | 'width'): string | null {
  const columns = table.columns
  let last = -1
  columns.forEach((column, at) => {
    if (column[field] !== undefined) last = at
  })
  if (last < 0) return null
  return columns.slice(0, last + 1).map((column) => columnEntry(column, field)).join(',')
}

/** The keys of the attribute line that the tree holds in the columns and the groups of the table. */
function tableKeys(table: TableNode, first: readonly (readonly [string, string])[]): BlockParts {
  const keys: (readonly [string, string])[] = [...first]
  const aligns = columnList(table, 'align')
  const widths = columnList(table, 'width')
  const footRows = rowsOf(table, 'table_foot').length
  if (aligns !== null) keys.push(['aligns', aligns])
  if (widths !== null) keys.push(['widths', widths])
  if (footRows > 0) keys.push(['footer-rows', String(footRows)])
  return { keys }
}

/** The content of a cell on its lines: a line feed stands where a continuation row breaks it (C2-W-067). */
function cellContent(w: Writer, cell: TableCellNode, flags: number): string {
  const blocks = cell.children
  // C2-A-175: blocks in a cell have no spelling.
  if (blocks.length > 1 || (blocks.length === 1 && blocks[0]!.type !== 'cell_paragraph')) lose(w, cell, null)
  // C2-W-012: the content of two former blocks is kept apart by a space.
  const content = blocks.map((block) => writeInlines(w, childNodes(block), flags | IN_CELL)).join(' ')
  // C2-W-063: a cell whose content is only a span mark and that is no span takes an escape.
  return content === '^' || content === '<' ? `\\${content}` : content
}

function cellPrefix(cell: TableCellNode): string {
  const align = cell.align
  const mark = align === undefined ? undefined : ALIGN_MARKS.get(align)
  return (cell.header ? '=' : '') + braceBlock(cell, mark === undefined ? {} : { mark })
}

/** C2-W-062, C2-W-118: the prefix, one space, the content and one space; an empty cell is its prefix and one space. */
function segment(prefix: string, content: string): string {
  return content === '' ? `${prefix} ` : `${prefix} ${content} `
}

/** The number of continuation rows below `row`, and for each cell the line of each of its fragments. */
/** C2-L-006: a wrap past the continuation rows of its row, or not behind the wrap before it, contradicts the record. */
function contradicts(wrap: Wrap, below: number, previous: number): boolean {
  return (wrap.row ?? 0) !== 0 || wrap.line < 1 || wrap.line > below || wrap.line <= previous
}

function fragmentLines(w: Writer, row: TableRowNode, cell: TableCellNode, count: number): number[] | null {
  const wraps = w.facts?.get(cell)?.wraps
  const below = w.facts?.get(row)?.continuationLines ?? 0
  if (wraps === undefined || wraps.length !== count) return null
  const lines: number[] = []
  for (const wrap of wraps) {
    if (contradicts(wrap, below, lines[lines.length - 1] ?? 0)) return null
    lines.push(wrap.line)
  }
  return lines
}

/** One cell as written: its prefix, the parts of its content, and the line of each part behind the first. */
interface WrittenCell {
  prefix: string
  parts: string[]
  places: number[]
}

function writtenCell(w: Writer, row: TableRowNode, cell: TableCellNode, flags: number): WrittenCell {
  const spanned = cell.span
  const span = spanned === undefined ? undefined : SPAN_MARKS.get(spanned)
  if (span !== undefined) return { prefix: '', parts: [span], places: [] }
  const parts = cellContent(w, cell, flags).split('\n')
  const recorded = fragmentLines(w, row, cell, parts.length - 1)
  if (recorded !== null) return { prefix: cellPrefix(cell), parts, places: recorded }
  // C2-L-035: without a record that fits, the row is one line.
  const wraps = w.facts?.get(cell)?.wraps?.length ?? 0
  if (wraps === parts.length - 1) return { prefix: cellPrefix(cell), parts: [parts.join(' ')], places: [] }
  // A line break that the content itself holds, as in a code span that crossed rows, is a continuation row in any case (C2-W-005).
  return { prefix: cellPrefix(cell), parts, places: parts.slice(1).map((_part, at) => at + 1) }
}

function writtenRow(w: Writer, row: TableRowNode, flags: number): WrittenRow {
  const cells = row.children.map((cell) => writtenCell(w, row, cell, flags))
  let below = w.facts?.get(row)?.continuationLines ?? 0
  for (const cell of cells) below = Math.max(below, cell.places[cell.places.length - 1] ?? 0)
  const lines: string[][] = []
  for (let line = 0; line <= below; line++) lines.push(new Array<string>(cells.length).fill(' '))
  cells.forEach((cell, column) => {
    lines[0]![column] = segment(cell.prefix, cell.parts[0]!)
    cell.places.forEach((line, at) => (lines[line]![column] = segment('', cell.parts[at + 1]!)))
  })
  return { lines, attribute: braceBlock(row) }
}

/** C2-W-118: pads the segments of each column to its widest. */
function alignColumns(rows: readonly WrittenRow[]): void {
  const widths: number[] = []
  for (const row of rows) {
    for (const line of row.lines) line.forEach((part, column) => (widths[column] = Math.max(widths[column] ?? 0, displayWidth(part))))
  }
  for (const row of rows) {
    for (const line of row.lines) line.forEach((part, column) => (line[column] = part + ' '.repeat(widths[column]! - displayWidth(part))))
  }
}

function emitRow(w: Writer, prefix: string, row: WrittenRow): void {
  row.lines.forEach((line, at) => {
    // C2-W-061, C2-B-175: a row is a pipe, its cells and a closing pipe; `+` leads a continuation row.
    const body = `${at === 0 ? '|' : '+'}${line.join('|')}|`
    emit(w, prefix, at === 0 ? body + row.attribute : body)
  })
}

function lineComment(w: Writer, node: CommentNode, prefix: string): void {
  const value = node.value
  emit(w, prefix, value === '' ? '%%' : `%% ${value}`)
}

/** The written rows of `table` and the comments between them, in source order (C2-A-086). */
function tableEntries(w: Writer, table: TableNode, flags: number): (WrittenRow | CommentNode)[] {
  const entries: (WrittenRow | CommentNode)[] = []
  for (const group of table.children) {
    if (group.type === 'comment') entries.push(group)
    else for (const row of group.children) entries.push(row.type === 'table_row' ? writtenRow(w, row, flags) : row)
  }
  return entries
}

function pipeTable(w: Writer, table: TableNode, prefix: string, flags: number): void {
  const block = braceBlock(table, tableKeys(table, []))
  if (block !== '') emit(w, prefix, block)
  const entries = tableEntries(w, table, flags)
  const rows = entries.filter((entry): entry is WrittenRow => 'lines' in entry)
  if (w.alignTables) alignColumns(rows)
  for (const entry of entries) {
    if ('lines' in entry) emitRow(w, prefix, entry)
    else lineComment(w, entry, prefix)
  }
}

/** Whether `cell` holds what a cell of a delimited table can: plain text and nothing else (C2-B-180). */
function isPlainCell(cell: TableCellNode, header: boolean): boolean {
  if (cell.header !== header || cell.span !== undefined || cell.align !== undefined) return false
  if (cell.attrs !== undefined || cell.lang !== undefined) return false
  const blocks = cell.children
  const block = blocks[0]
  if (blocks.length !== 1 || block?.type !== 'cell_paragraph') return false
  const content = block.children
  const first = content[0]
  return content.length === 0 || (content.length === 1 && first?.type === 'text' && first.attrs === undefined)
}

function isPlainRow(row: RowEntry, header: boolean): boolean {
  return row.type === 'table_row' && row.attrs === undefined && row.children.every((cell) => isPlainCell(cell, header))
}

function isPlainGroup(group: TableEntry, header: boolean): boolean {
  return group.type === 'comment' || group.children.every((row) => isPlainRow(row, header))
}

/** C2-L-006: whether a delimited table can hold `table`. */
function fitsDelimited(table: TableNode): boolean {
  const groups = table.children
  const head = groups.filter((group) => group.type === 'table_head')
  const body = groups.filter((group) => group.type === 'table_body')
  if (head.length + body.length !== groups.length || head.length > 1 || body.length > 1) return false
  return fitsPartition(groups, head[0]?.children.length ?? 0, body[0])
}

/** Whether a delimited table gives the head of `headRows` rows and the body `body` (C2-B-209, C2-A-088). */
function fitsPartition(groups: readonly TableEntry[], headRows: number, body: TableBodyNode | undefined): boolean {
  const declared = body?.headRows
  // Without `header-rows` a delimited table has one head row; with it the body says so.
  if (body === undefined || declared === undefined) return (headRows === 1 || groups.length === 0) && hasPlainGroups(groups, false)
  // A count larger than the number of rows gives no head, and every cell is a header cell.
  const beyond = declared > body.children.length + headRows
  return (beyond ? headRows === 0 : declared === headRows) && hasPlainGroups(groups, beyond)
}

/** Whether every cell of `groups` is plain, a header cell in the head and, with `headerBody`, in the body. */
function hasPlainGroups(groups: readonly TableEntry[], headerBody: boolean): boolean {
  return groups.every((group) => isPlainGroup(group, headerBody || group.type === 'table_head'))
}

/** The value of the first node of the first block of `cell`, where that node has one. */
function firstValue(cell: TableCellNode): string | undefined {
  const block = cell.children[0]
  const first = block === undefined ? undefined : childNodes(block)[0]
  return first !== undefined && 'value' in first ? first.value : undefined
}

/** Whether the first node of the first block of `cell` is text with a line break. */
function cellHoldsLineBreak(cell: TableCellNode): boolean {
  return firstValue(cell)?.includes('\n') === true
}

function holdsLineBreak(table: TableNode): boolean {
  return table.children.some((group) => group.type !== 'comment' && group.children.some(
    (row) => row.type === 'table_row' && row.children.some(cellHoldsLineBreak),
  ))
}

/** The head rows a group of `table` declares (C2-A-088). */
function declaredHeadRows(table: TableNode): number | undefined {
  for (const group of table.children) if (group.type === 'table_body' && group.headRows !== undefined) return group.headRows
  return undefined
}

/** C2-W-066: the form of the table, `pipe`, `csv` or `tsv`. */
function tableFormat(w: Writer, table: TableNode): string {
  const recorded = w.facts?.get(table)?.sourceFormat
  const declares = declaredHeadRows(table) !== undefined
  const rows = rowsOf(table, 'table_head').length + rowsOf(table, 'table_body').length + rowsOf(table, 'table_foot').length
  if (!fitsDelimited(table)) {
    // A pipe table needs a row (C2-L-036) and cannot declare its head rows (C2-A-088).
    for (const group of table.children) if (group.type === 'table_body' && group.headRows !== undefined) lose(w, group, 'headRows')
    return 'pipe'
  }
  if (recorded === 'csv' || recorded === 'tsv') return recorded
  // C2-W-005: a cell of a pipe table holds no line break.
  return declares || rows === 0 || holdsLineBreak(table) ? 'csv' : 'pipe'
}

/** C2-W-066: a cell that holds the separator, a double quote or a line break stands in double quotes. */
function delimitedCell(cell: TableCellNode, separator: string): string {
  const value = firstValue(cell) ?? ''
  if (!value.includes(separator) && !value.includes('"') && !value.includes('\n')) return value
  return `"${value.replaceAll('"', '""')}"`
}

function delimitedRow(row: TableRowNode, separator: string): string {
  return row.children.map((cell) => delimitedCell(cell, separator)).join(separator)
}

function longestBacktickLine(lines: readonly string[]): number {
  let longest = 0
  for (const line of lines) {
    const text = trimSpaces(line)
    if (text !== '' && text === '`'.repeat(text.length)) longest = Math.max(longest, text.length)
  }
  return longest
}

function delimitedTable(w: Writer, table: TableNode, prefix: string, format: string): void {
  const separator = format === 'tsv' ? '\t' : ','
  const first: (readonly [string, string])[] = [['table', '']]
  const declared = declaredHeadRows(table)
  if (declared !== undefined) first.push(['header-rows', String(declared)])
  emit(w, prefix, braceBlock(table, tableKeys(table, first)))
  const body: string[] = []
  for (const group of table.children) {
    if (group.type === 'comment') continue
    for (const row of group.children) body.push(row.type === 'table_row' ? delimitedRow(row, separator) : '')
  }
  const lines = body.join('\n').split('\n')
  const run = '`'.repeat(Math.max(MIN_RUN, longestBacktickLine(lines) + 1))
  emit(w, prefix, run + format)
  if (body.length > 0) for (const line of lines) emit(w, prefix, line)
  emit(w, prefix, run)
}

export function writeTable(w: Writer, table: TableNode, prefix: string, flags: number): void {
  const format = tableFormat(w, table)
  if (format === 'pipe') pipeTable(w, table, prefix, flags)
  else delimitedTable(w, table, prefix, format)
}
