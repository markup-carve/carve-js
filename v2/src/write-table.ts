// Tables as Carve source (C2-W-061 to C2-W-068, C2-W-118): a pipe table, with the continuation
// rows the sidecar records, or a delimited table.
import {
  childNodes, type CommentNode, type TableBodyNode, type TableCellNode, type TableColumnNode, type TableNode, type TableRowNode,
} from './ast.ts'
import { type BlockParts, braceBlock } from './write-attributes.ts'
import { IN_CELL, writeInlines } from './write-inline.ts'
import { AFTER_MARK, AS_INLINES, planLeaf, unplanned } from './write-plan.ts'
import { emit, lose, loseKey, type Writer } from './write-state.ts'
import { type Wrap } from './layout.ts'
import { longestBareRun } from './write-fences.ts'
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

/**
 * The keys of the attribute line that the tree holds in the columns and the groups of the table. C2-W-136: a key
 * that `attrs` holds too is written from the fields, and the key in `attrs` is reported where `w` is given.
 */
function tableKeys(w: Writer | null, table: TableNode, first: readonly (readonly [string, string])[]): BlockParts {
  const keys: (readonly [string, string])[] = [...first]
  const aligns = columnList(table, 'align')
  const widths = columnList(table, 'width')
  const footRows = rowsOf(table, 'table_foot').length
  if (aligns !== null) keys.push(['aligns', aligns])
  if (widths !== null) keys.push(['widths', widths])
  if (footRows > 0) keys.push(['footer-rows', String(footRows)])
  const skipKeys: string[] = []
  table.attrs?.keyValues?.forEach(([key], index) => {
    if (!keys.some((pair) => pair[0] === key)) return
    skipKeys.push(key)
    if (w !== null) loseKey(w, table, index, key)
  })
  return { keys, skipKeys }
}

/** The content of a cell on its lines: a line feed stands where a continuation row breaks it (C2-W-067). */
function cellContent(w: Writer, cell: TableCellNode, flags: number): string {
  const blocks = cell.children
  // C2-A-175: blocks in a cell have no spelling.
  if (blocks.length > 1 || (blocks.length === 1 && blocks[0]!.type !== 'cell_paragraph')) lose(w, cell, null)
  // C2-W-012: the content of two former blocks is kept apart by a space.
  if (blocks.length > 1) unplanned(w, 'cell blocks')
  const content = blocks.map((block) => planLeaf(w, childNodes(block), flags | IN_CELL,
    writeInlines(w, childNodes(block), flags | IN_CELL), AS_INLINES, AFTER_MARK)).join(' ')
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
  // C2-L-035: without a record that fits, the row is one line. C2-L-021: a fragment that starts an empty cell came
  // without a joining space, so it is joined without one.
  const wraps = w.facts?.get(cell)?.wraps?.length ?? 0
  const joined = (wraps === parts.length - 1 && parts[0] === '' ? parts.slice(1) : parts).join(' ')
  return { prefix: cellPrefix(cell), parts: [joined], places: [] }
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
  const block = braceBlock(table, tableKeys(w, table, []))
  if (w.prewrittenAttributes === table) w.prewrittenAttributes = null
  else if (block !== '') emit(w, prefix, block)
  const entries = tableEntries(w, table, flags)
  const rows = entries.filter((entry): entry is WrittenRow => 'lines' in entry)
  // C2-A-086: a comment that ends the last group stands before a continuation row; an empty one adds nothing (C2-B-184).
  const closing = endsWithGroupComment(table)
  const last = rows[rows.length - 1]
  if (closing && last !== undefined) dropBlankTail(last)
  if (w.alignTables) alignColumns(rows)
  for (const entry of entries) {
    if ('lines' in entry) emitRow(w, prefix, entry)
    else lineComment(w, entry, prefix)
  }
  if (closing) emit(w, prefix, '+ |')
}

/** Trap: the recorded empty continuation row that followed the comment is the one written after it. */
function dropBlankTail(row: WrittenRow): void {
  while (row.lines.length > 1 && row.lines.at(-1)?.every((part) => part.trim() === '') === true) row.lines.pop()
}

function endsWithGroupComment(table: TableNode): boolean {
  const last = table.children[table.children.length - 1]
  return last !== undefined && last.type !== 'comment' && last.children[last.children.length - 1]?.type === 'comment'
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

/**
 * Whether a delimited table gives the head of `headRows` rows and the body `body` (C2-B-209, C2-A-088). Without
 * `header-rows` it has one head row; with it the body says so, and a table with no body takes the count of its
 * head (C2-B-221).
 */
function fitsPartition(groups: readonly TableEntry[], headRows: number, body: TableBodyNode | undefined): boolean {
  if (body === undefined) return hasPlainGroups(groups)
  const declared = body.headRows
  return (declared === undefined ? headRows === 1 : declared === headRows) && hasPlainGroups(groups)
}

/** Whether every cell of `groups` is plain, a header cell in the head. */
function hasPlainGroups(groups: readonly TableEntry[]): boolean {
  return groups.every((group) => isPlainGroup(group, group.type === 'table_head'))
}

/** The value of the first node of the first block of `cell`, where that node has one. */
function firstValue(cell: TableCellNode): string | undefined {
  const block = cell.children[0]
  const first = block === undefined ? undefined : childNodes(block)[0]
  return first !== undefined && 'value' in first ? first.value : undefined
}

function isBlankCode(code: number): boolean {
  return code === 32 || code === 9
}

/**
 * Whether the text of `cell` has no spelling in a pipe cell: a line break (C2-W-005), or a space or a tab at either
 * end, which is padding of a pipe cell (C2-B-171).
 */
function cellNeedsDelimited(cell: TableCellNode): boolean {
  const value = firstValue(cell)
  if (value === undefined || value === '') return false
  return value.includes('\n') || isBlankCode(value.charCodeAt(0)) || isBlankCode(value.charCodeAt(value.length - 1))
}

function needsDelimited(table: TableNode): boolean {
  return table.children.some((group) => group.type !== 'comment' && group.children.some(
    (row) => row.type === 'table_row' && row.children.some(cellNeedsDelimited),
  ))
}

/** The head rows a group of `table` declares (C2-A-088). */
function declaredHeadRows(table: TableNode): number | undefined {
  for (const group of table.children) if (group.type === 'table_body' && group.headRows !== undefined) return group.headRows
  return undefined
}

/** C2-W-066, C2-B-221: the `header-rows` of a delimited table: what its body declares, or the head rows of a table with no body. */
function headerRows(table: TableNode): number | undefined {
  const declared = declaredHeadRows(table)
  if (declared !== undefined || table.children.some((group) => group.type === 'table_body')) return declared
  const head = rowsOf(table, 'table_head').length
  return head <= 1 ? undefined : head
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
  return declares || rows === 0 || needsDelimited(table) ? 'csv' : 'pipe'
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

function delimitedTable(w: Writer, table: TableNode, prefix: string, format: string): void {
  const separator = format === 'tsv' ? '\t' : ','
  const first: (readonly [string, string])[] = [['table', '']]
  const declared = headerRows(table)
  if (declared !== undefined) first.push(['header-rows', String(declared)])
  const block = braceBlock(table, tableKeys(w, table, first))
  if (w.prewrittenAttributes === table) w.prewrittenAttributes = null
  else emit(w, prefix, block)
  const body: string[] = []
  for (const group of table.children) {
    if (group.type === 'comment') continue
    for (const row of group.children) body.push(row.type === 'table_row' ? delimitedRow(row, separator) : '')
  }
  const lines = body.join('\n').split('\n')
  const run = '`'.repeat(Math.max(MIN_RUN, longestBareRun(lines, 96) + 1))
  emit(w, prefix, run + format)
  if (body.length > 0) for (const line of lines) emit(w, prefix, line)
  emit(w, prefix, run)
}

export function writeTable(w: Writer, table: TableNode, prefix: string, flags: number): void {
  const format = tableFormat(w, table)
  if (format === 'pipe') pipeTable(w, table, prefix, flags)
  else delimitedTable(w, table, prefix, format)
}

/** C2-W-122: the same table attribute line before an intervening comment as before the table itself. */
export function tableAttribute(w: Writer, table: TableNode): string {
  const format = tableFormat(w, table)
  if (format === 'pipe') return braceBlock(table, tableKeys(null, table, []))
  const first: (readonly [string, string])[] = [['table', '']]
  const declared = headerRows(table)
  if (declared !== undefined) first.push(['header-rows', String(declared)])
  return braceBlock(table, tableKeys(null, table, first))
}
