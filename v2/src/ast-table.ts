// The tables of the public tree (C2-A-086 to C2-A-095): groups, rows, cells and columns, from
// the rows of the block tree and from the rows of a delimited table.
import {
  type CellParagraphNode, type CommentNode, type Inline, isFieldValue, type TableBodyNode, type TableCellNode, type TableColumnNode,
  type TableFootNode, type TableHeadNode, type TableNode, type TableRowNode,
} from './ast.ts'
import { applyAbbreviations } from './ast-abbreviations.ts'
import { type Attributes, emptyAttributes, readAttributeLines, readGluedBlocks, takeKey } from './ast-attributes.ts'
import {
  commentValue, contentNodes, FLOW_CELL, FLOW_UNPLACED, joinFragment, leafInlines, noteLeaf, place, setAttributes, type TreeContext,
} from './ast-inline.ts'
import { CARET, DIGIT_0, DIGIT_9, DOT, GREATER, LESS, PERCENT, TILDE } from './chars.ts'
import { readDelimitedTable } from './delimited.ts'
import { DELIMITED_MALFORMED } from './parse-findings.ts'
import { COMMENT, FLAG_CELL_ATTRIBUTES, FLAG_HEADER } from './kinds.ts'
import { attributeBlocksEnd, countValue, isInnerLineComment, rowClosingPipe, skipSpaces } from './lines.ts'
import { trimSpaces } from './source.ts'
import type { BlockNode } from './tree.ts'
import { holdsBidiControl } from './unicode.ts'

const MAX_WIDTH = 100

type CommentBuilder = (ctx: TreeContext, node: BlockNode) => CommentNode

/** The rows of a table group and the comments between them. */
type GroupRows = (TableRowNode | CommentNode)[]

/** The rows of one table as they are sorted into groups. */
interface Groups {
  head: GroupRows
  body: GroupRows
  foot: GroupRows
  width: number
  /** The source range of each group, by its row list. A delimited table has none (C2-A-158). */
  ranges: Map<GroupRows, [number, number]>
  /** The comments behind the last row, which are children of the table (C2-A-075, C2-A-086). */
  trailing: CommentNode[]
}

function emptyGroups(): Groups {
  return { head: [], body: [], foot: [], width: 0, ranges: new Map(), trailing: [] }
}

/** Widens the range of the group `rows` to hold `[start, end)`. */
function extend(groups: Groups, rows: GroupRows, start: number, end: number): void {
  const range = groups.ranges.get(rows)
  if (range === undefined) groups.ranges.set(rows, [start, end])
  else range[1] = Math.max(range[1], end)
}

function alignmentOf(mark: number): 'left' | 'right' | 'center' {
  if (mark === LESS) return 'left'
  return mark === GREATER ? 'right' : 'center'
}

/** C2-B-182: `^` top, `~` middle, `v` bottom. */
function valignOf(mark: number): 'top' | 'middle' | 'bottom' {
  if (mark === CARET) return 'top'
  return mark === TILDE ? 'middle' : 'bottom'
}

/** C2-A-092: the cell a span mark stood in. It has no content of its own and a covering cell holds the counts. */
function coveredCell(ctx: TreeContext, span: 'rowspan' | 'colspan', marks: Marks): TableCellNode {
  const cell: TableCellNode = { type: 'table_cell', header: false, span, children: [] }
  const spans = marks.row.spans
  if (spans === null || marks.next + 1 >= spans.length) return cell
  const start = spans[marks.next]!
  const end = spans[marks.next + 1]!
  marks.next += 2
  // C2-A-149, C2-A-158: a span mark cell spans the text between its pipes.
  return place(ctx, cell, start, end)
}

/** The span marks of a row, in column order, and the next one a covered cell takes. */
interface Marks {
  row: BlockNode
  next: number
}

/** C2-B-171: the brace blocks glued to the pipe or to the header cell mark of a cell. */
function cellAttributes(ctx: TreeContext, node: BlockNode): Attributes | null {
  if ((node.flags & FLAG_CELL_ATTRIBUTES) === 0) return null
  const attributes = emptyAttributes()
  const start = node.start + ((node.flags & FLAG_HEADER) !== 0 ? 2 : 1)
  // C2-I-034: the prefix ends before a glued block that is no valid attribute block.
  readGluedBlocks(ctx.src, start, attributeBlocksEnd(ctx.src, start, node.end, true), attributes)
  return attributes
}

/** C2-B-184: each fragment of a cell is an inline content of its own. */
function fragmentInlines(ctx: TreeContext, spans: number[], flow: number): Inline[] {
  if (spans.length <= 2) return leafInlines(ctx, spans, flow)
  ctx.resolvable = false
  const children: Inline[] = []
  let joined = false
  for (let at = 0; at < spans.length; at += 2) {
    // An empty fragment adds nothing.
    if (spans[at] === spans[at + 1]) continue
    const nodes = contentNodes(ctx, spans, at, at + 2, true, flow)
    if (joined) joinFragment(ctx, children, nodes, spans[at]!)
    else for (const child of nodes) children.push(child)
    joined = true
  }
  return children
}

function cellNode(ctx: TreeContext, node: BlockNode, rowEnd: number): TableCellNode {
  // C2-A-158: a cell that a continuation row joined or formed has no position, and neither has its content.
  const joined = node.spans!.length > 2 || (node.spans!.length === 2 && node.spans![1]! > node.end) || node.start >= rowEnd
  const flow = joined ? FLOW_CELL | FLOW_UNPLACED : FLOW_CELL
  const children = fragmentInlines(ctx, node.spans!, flow)
  // C2-I-098: a cell is inline flow like any other leaf. A term holds no space, so none matches across a join.
  if (ctx.abbreviations.size > 0) applyAbbreviations(ctx, children)
  const paragraph: CellParagraphNode = noteLeaf(ctx, { type: 'cell_paragraph', children })
  const cell: TableCellNode = { type: 'table_cell', header: (node.flags & FLAG_HEADER) !== 0, children: [paragraph] }
  if (node.facts > 1) cell.colspan = node.facts
  if (node.rowFacts > 1) cell.rowspan = node.rowFacts
  if ((node.aux & 0xff) !== 0) cell.align = alignmentOf(node.aux & 0xff)
  if (node.aux >> 8 !== 0) cell.valign = valignOf(node.aux >> 8)
  setAttributes(cell, cellAttributes(ctx, node))
  if (ctx.trace !== null) ctx.trace.blocks.set(cell, node)
  if (joined) return cell
  const spans = node.spans!
  // C2-A-158: the paragraph of an empty cell has no source character.
  if (spans.length === 2 && spans[0]! < spans[1]!) place(ctx, paragraph, spans[0]!, spans[1]!)
  // C2-A-149: a cell spans the text between its pipes.
  return place(ctx, cell, node.start + 1, node.end)
}

/**
 * The cells of one row with the cells of its span marks back at their columns (C2-A-092).
 * `covered` holds, per column, how many further rows a cell above still spans.
 */
function rowCells(ctx: TreeContext, row: BlockNode, covered: number[], rowEnd: number): TableCellNode[] {
  const cells: TableCellNode[] = []
  const marks: Marks = { row, next: 0 }
  const takeCovered = (): void => {
    while (cells.length < covered.length && covered[cells.length]! > 0) {
      covered[cells.length]!--
      cells.push(coveredCell(ctx, 'rowspan', marks))
    }
  }
  const formed: TableCellNode[] = []
  for (const node of row.children!) {
    takeCovered()
    const cell = cellNode(ctx, node, rowEnd)
    const column = cells.length
    cells.push(cell)
    if (node.start >= rowEnd) formed.push(cell)
    for (let more = 1; more < (cell.colspan ?? 1); more++) cells.push(coveredCell(ctx, 'colspan', marks))
    covered[column] = (cell.rowspan ?? 1) - 1
  }
  takeCovered()
  if (formed.length > 0 && isHeaderRow(cells.filter((cell) => !formed.includes(cell)))) for (const cell of formed) cell.header = true
  return cells
}

/** C2-B-176: every cell is a header cell, a `<` mark cell counting as the cell it extends and a `^` mark cell as data. */
function isHeaderRow(cells: readonly TableCellNode[]): boolean {
  return cells.length > 0 && cells.every((cell) => cell.span === 'colspan' || (cell.span !== 'rowspan' && cell.header))
}

function holdsPercent(src: string, start: number, end: number): boolean {
  for (let at = start; at < end; at++) if (src.charCodeAt(at) === PERCENT) return true
  return false
}

/**
 * C2-B-167: the end of the row behind its closing pipe and row attribute, and where its trailing line
 * comment starts, or -1 when it has none.
 */
function rowTail(src: string, row: BlockNode, lineEnd: number): [number, number] {
  const pipe = holdsPercent(src, row.start, lineEnd) ? rowClosingPipe(src, row.start, lineEnd) : -1
  if (pipe < 0) return [lineEnd, -1]
  const behind = row.aux !== 0 ? attributeBlocksEnd(src, row.aux, lineEnd) : pipe + 1
  const tail = skipSpaces(src, behind, lineEnd)
  return tail < lineEnd && tail > behind && isInnerLineComment(src, tail, lineEnd) ? [behind, tail] : [lineEnd, -1]
}

/** C2-A-086: the trailing line comment of a row, from the first space before its `%%` to the line ending (C2-A-151). */
function rowComment(ctx: TreeContext, start: number, marker: number, lineEnd: number): CommentNode {
  return place(ctx, { type: 'comment', form: 'line', value: commentValue(ctx.src.slice(marker + 2, lineEnd), false) }, start, lineEnd)
}

function rowNode(ctx: TreeContext, row: BlockNode, covered: number[], rowEnd: number): TableRowNode {
  const firstEnd = rowRangeEnd(ctx.src, row)
  const joined = firstEnd < row.end
  const out: TableRowNode = { type: 'table_row', children: rowCells(ctx, row, covered, joined ? firstEnd : row.end + 1) }
  if (ctx.trace !== null) ctx.trace.blocks.set(out, row)
  if (row.aux !== 0) {
    // C2-B-167: the row attribute stands behind the closing pipe.
    const attributes = emptyAttributes()
    readGluedBlocks(ctx.src, row.aux, row.end, attributes)
    setAttributes(out, attributes)
  }
  // C2-A-158: a row that a continuation row joined has no position.
  return joined ? out : place(ctx, out, row.start, rowEnd)
}

/** Where the sort of the rows of one table stands. */
interface RowCursor {
  headRows: number
  footStart: number
  /** The row index of the next row that is no comment. */
  index: number
  group: GroupRows
  covered: number[]
  /** The end of the last comment in `groups.trailing`. */
  trailingEnd: number
}

/** The end of the first line of a row: the lines below it are continuation rows (C2-B-175). */
function rowRangeEnd(src: string, row: BlockNode): number {
  const lineEnd = src.indexOf('\n', row.start)
  return lineEnd >= 0 && lineEnd < row.end ? lineEnd : row.end
}

/** C2-A-086: the comments above a row belong to the group of the row above them. */
function flushTrailing(groups: Groups, cursor: RowCursor, rowStart: number): void {
  if (groups.trailing.length === 0) return
  for (const pending of groups.trailing) cursor.group.push(pending)
  extend(groups, cursor.group, rowStart, cursor.trailingEnd)
  groups.trailing = []
}

function addRow(ctx: TreeContext, groups: Groups, cursor: RowCursor, child: BlockNode): void {
  flushTrailing(groups, cursor, child.start)
  // C2-B-174: a row span does not cross the head boundary.
  if (cursor.index === cursor.headRows) cursor.covered = []
  if (cursor.index < cursor.headRows) cursor.group = groups.head
  else cursor.group = cursor.index < cursor.footStart ? groups.body : groups.foot
  const lineEnd = rowRangeEnd(ctx.src, child)
  const [end, marker] = rowTail(ctx.src, child, lineEnd)
  const row = rowNode(ctx, child, cursor.covered, marker < 0 ? child.end : end)
  groups.width = Math.max(groups.width, row.children.length)
  cursor.group.push(row)
  // C2-A-144, C2-A-151: the group owns the continuation rows of its rows.
  extend(groups, cursor.group, child.start, marker < 0 || lineEnd < child.end ? child.end : end)
  cursor.index++
  if (marker < 0) return
  // C2-A-086: the comment takes the place of a comment-only line directly below the row.
  groups.trailing.push(rowComment(ctx, end, marker, lineEnd))
  cursor.trailingEnd = lineEnd
}

function sortRows(ctx: TreeContext, node: BlockNode, comment: CommentBuilder): Groups {
  const headRows = node.facts
  const rowCount = node.children!.reduce((count, child) => count + (child.kind === COMMENT ? 0 : 1), 0)
  const groups = emptyGroups()
  const cursor: RowCursor = {
    headRows, footStart: rowCount - node.rowFacts, index: 0, group: headRows > 0 ? groups.head : groups.body,
    covered: [], trailingEnd: 0,
  }
  for (const child of node.children!) {
    if (child.kind !== COMMENT) {
      addRow(ctx, groups, cursor, child)
      continue
    }
    const out = comment(ctx, child)
    if (ctx.trace !== null) ctx.trace.blocks.set(out, child)
    groups.trailing.push(out)
    cursor.trailingEnd = child.end
  }
  // C2-A-086, C2-A-145: a comment before a continuation row of the last row is not below that row.
  const range = groups.ranges.get(cursor.group)
  while (range !== undefined && (groups.trailing[0]?.pos?.startOffset ?? range[1]) < range[1]) {
    const comment = groups.trailing.shift()
    if (comment !== undefined) cursor.group.push(comment)
  }
  return groups
}

/** C2-B-212: a decimal number above 0 and at most 100 as a fraction of the table width, or undefined. */
function columnWidth(entry: string): number | undefined {
  let dots = 0
  for (let at = 0; at < entry.length; at++) {
    const code = entry.charCodeAt(at)
    if (code === DOT) dots++
    else if (code < DIGIT_0 || code > DIGIT_9) return undefined
  }
  // Digits with at most one dot between them: `25` and `30.5`, and not `.5`, `5.` or `1e2`.
  if (entry === '' || dots > 1 || entry.startsWith('.') || entry.endsWith('.')) return undefined
  const percent = Number(entry)
  return percent > 0 && percent <= MAX_WIDTH ? percent / MAX_WIDTH : undefined
}

function alignEntry(entry: string): string | undefined {
  return isFieldValue('table_column.align', entry) ? entry : undefined
}

/** C2-B-211: `valigns` takes `top`, `middle` and `bottom`; `baseline` has no source. */
function valignEntry(entry: string): string | undefined {
  return entry === 'top' || entry === 'middle' || entry === 'bottom' ? entry : undefined
}

/** C2-B-211, C2-B-212: the entries of a column list, or null when the list is absent or any entry is not valid. */
function columnEntries<T>(value: string | null, read: (entry: string) => T | undefined): T[] | null {
  if (value === null) return null
  const out: T[] = []
  for (const entry of value.split(',')) {
    const read1 = read(trimSpaces(entry))
    if (read1 === undefined) return null
    out.push(read1)
  }
  return out
}

/** The column lists of a table: `aligns`, `valigns` and `widths` (C2-B-211, C2-B-212). */
interface ColumnLists {
  aligns: string[] | null
  valigns: string[] | null
  widths: number[] | null
}

/** C2-A-089: one column per position up to the widest row, with what the column lists spell. */
function columnNodes(width: number, lists: ColumnLists): TableColumnNode[] {
  const columns: TableColumnNode[] = []
  for (let at = 0; at < width; at++) {
    const column: TableColumnNode = { type: 'table_column' }
    const align = lists.aligns?.[at]
    const valign = lists.valigns?.[at]
    const fraction = lists.widths?.[at]
    if (align !== undefined && isFieldValue('table_column.align', align)) column.align = align
    if (valign !== undefined && isFieldValue('table_column.valign', valign)) column.valign = valign
    if (fraction !== undefined) column.width = fraction
    columns.push(column)
  }
  return columns
}

function keyOf(attributes: Attributes | null, name: string): string | null {
  return attributes?.keyValues.find((pair) => pair[0] === name)?.[1] ?? null
}

/** C2-B-227: a key whose value is valid is consumed; an invalid one has no effect and stays in `attrs`. */
function consumed<T>(attributes: Attributes | null, name: string, valid: T | null): T | null {
  if (valid !== null) takeKey(attributes, name)
  return valid
}

function count(value: string | null): number | null {
  const parsed = countValue(value)
  return parsed < 0 ? null : parsed
}

function groupNode(
  ctx: TreeContext, groups: Groups, type: 'table_head' | 'table_body' | 'table_foot', rows: GroupRows,
): TableHeadNode | TableBodyNode | TableFootNode {
  const range = groups.ranges.get(rows)
  const group: TableHeadNode | TableBodyNode | TableFootNode = { type, children: rows }
  return range === undefined ? group : place(ctx, group, range[0], range[1])
}

/**
 * C2-B-227: `aligns`, `valigns`, `widths`, `header-rows` and `footer-rows` are read here. A valid key that applies to the
 * table form is consumed; an invalid one, and `header-rows` on a pipe table (C2-B-186), stays in `attrs`.
 */
function tableOf(ctx: TreeContext, groups: Groups, attributes: Attributes | null, delimited: boolean): TableNode {
  consumed(attributes, 'footer-rows', count(keyOf(attributes, 'footer-rows')))
  if (delimited) consumed(attributes, 'header-rows', count(keyOf(attributes, 'header-rows')))
  const aligns = consumed(attributes, 'aligns', columnEntries(keyOf(attributes, 'aligns'), alignEntry))
  const valigns = consumed(attributes, 'valigns', columnEntries(keyOf(attributes, 'valigns'), valignEntry))
  const widths = consumed(attributes, 'widths', columnEntries(keyOf(attributes, 'widths'), columnWidth))
  const columns = columnNodes(groups.width, { aligns, valigns, widths })
  const table: TableNode = { type: 'table', columns, children: [] }
  if (groups.head.length > 0) table.children.push(groupNode(ctx, groups, 'table_head', groups.head))
  if (groups.body.length > 0) table.children.push(groupNode(ctx, groups, 'table_body', groups.body))
  if (groups.foot.length > 0) table.children.push(groupNode(ctx, groups, 'table_foot', groups.foot))
  for (const pending of groups.trailing) table.children.push(pending)
  setAttributes(table, attributes)
  return table
}

/** A pipe table. `comment` builds the node of a comment-only line between two rows. */
export function tableNode(ctx: TreeContext, node: BlockNode, comment: CommentBuilder): TableNode {
  return tableOf(ctx, sortRows(ctx, node, comment), readAttributeLines(ctx.src, node.attributes), false)
}

function delimitedRow(cells: string[], header: boolean): TableRowNode {
  return {
    type: 'table_row',
    children: cells.map((value) => ({
      type: 'table_cell', header,
      children: [{ type: 'cell_paragraph', children: value === '' ? [] : [{ type: 'text', value }] }],
    })),
  }
}

/** C2-B-180: a `csv` or `tsv` fence that the `table` attribute marks. Its cells are plain text with no position (C2-A-158). */
export function delimitedTableNode(ctx: TreeContext, node: BlockNode): TableNode {
  const source = readDelimitedTable(ctx.src, node)
  const rows = source.rows
  // C2-H-172: the cells are text that the inline scan does not read.
  if (!ctx.inline.bidi) ctx.inline.bidi = holdsBidiControl(ctx.src, node.start, node.end)
  const attributes = readAttributeLines(ctx.src, node.attributes)
  takeKey(attributes, 'table')
  // C2-B-209: a count past the last row is the number of rows.
  const head = Math.min(source.headRows, rows.length)
  // C2-B-187: the footer rows are counted among the rows below the head.
  const footer = Math.min(Math.max(0, countValue(keyOf(attributes, 'footer-rows'))), Math.max(0, rows.length - head))
  const groups = emptyGroups()
  rows.forEach((cells, index) => {
    groups.width = Math.max(groups.width, cells.length)
    const group = index < head ? groups.head : index < rows.length - footer ? groups.body : groups.foot
    group.push(delimitedRow(cells, index < head))
  })
  const table = tableOf(ctx, groups, attributes, true)
  // C2-B-181: a quote that never closes is reported, and the block stays a table.
  if (source.malformed) ctx.notes.push({ what: DELIMITED_MALFORMED, node: table, block: node, from: 0 })
  return table
}
