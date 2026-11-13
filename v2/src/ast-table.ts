// The tables of the public tree (C2-A-086 to C2-A-095): groups, rows, cells and columns, from
// the rows of the block tree and from the rows of a delimited table.
import { type AstNode } from './ast.ts'
import { type Attributes, emptyAttributes, readAttributeLines, readGluedBlocks, takeKey } from './ast-attributes.ts'
import {
  FLOW_CELL, FLOW_PLAIN, FLOW_UNPLACED, leafInlines, place, setAttributes, type TreeContext,
} from './ast-inline.ts'
import { DIGIT_0, DIGIT_9, DOT, EQUALS, GREATER, LESS } from './chars.ts'
import { readDelimitedTable } from './delimited.ts'
import { COMMENT, FLAG_CELL_ATTRIBUTES, FLAG_HEADER } from './kinds.ts'
import { countValue } from './lines.ts'
import { type BlockNode, FACT_MASK, FACT_SHIFT } from './tree.ts'

// C2-B-211: the entries of `aligns` that set an alignment.
const ALIGN_WORDS = ['left', 'right', 'center']
const MAX_WIDTH = 100

type CommentBuilder = (ctx: TreeContext, node: BlockNode) => AstNode

/** The rows of one table as they are sorted into groups. */
interface Groups {
  head: AstNode[]
  body: AstNode[]
  foot: AstNode[]
  width: number
  /** The source range of each group, by its row list. A delimited table has none (C2-A-158). */
  ranges: Map<AstNode[], [number, number]>
  /** The comments behind the last row, which are children of the table (C2-A-075, C2-A-086). */
  trailing: AstNode[]
}

function emptyGroups(): Groups {
  return { head: [], body: [], foot: [], width: 0, ranges: new Map(), trailing: [] }
}

/** Widens the range of the group `rows` to hold `[start, end)`. */
function extend(groups: Groups, rows: AstNode[], start: number, end: number): void {
  const range = groups.ranges.get(rows)
  if (range === undefined) groups.ranges.set(rows, [start, end])
  else range[1] = end
}

function alignmentOf(mark: number): string {
  if (mark === LESS) return 'left'
  return mark === GREATER ? 'right' : 'center'
}

/** C2-A-092: the cell a span mark stood in. It has no content of its own and a covering cell holds the counts. */
function coveredCell(span: string): AstNode {
  return { type: 'table_cell', header: false, span, children: [] }
}

/** C2-B-171: the brace blocks glued to the pipe or to the header cell mark of a cell. */
function cellAttributes(ctx: TreeContext, node: BlockNode): Attributes | null {
  if ((node.flags & FLAG_CELL_ATTRIBUTES) === 0) return null
  const attributes = emptyAttributes()
  const start = node.start + (ctx.src.charCodeAt(node.start + 1) === EQUALS ? 2 : 1)
  readGluedBlocks(ctx.src, start, node.end, attributes)
  return attributes
}

function cellNode(ctx: TreeContext, node: BlockNode, rowEnd: number): AstNode {
  // C2-A-158: a cell that a continuation row joined or formed has no position, and neither has its content.
  const joined = node.spans!.length > 2 || (node.spans!.length === 2 && node.spans![0]! >= node.end) || node.start >= rowEnd
  const flow = joined ? FLOW_CELL | FLOW_UNPLACED : FLOW_PLAIN
  const paragraph: AstNode = { type: 'cell_paragraph' }
  paragraph.children = leafInlines(ctx, paragraph, node.spans!, flow)
  const cell: AstNode = { type: 'table_cell', header: (node.flags & FLAG_HEADER) !== 0, children: [paragraph] }
  if ((node.facts & FACT_MASK) > 1) cell.colspan = node.facts & FACT_MASK
  if (node.facts >> FACT_SHIFT > 1) cell.rowspan = node.facts >> FACT_SHIFT
  if (node.aux !== 0) cell.align = alignmentOf(node.aux)
  setAttributes(cell, cellAttributes(ctx, node))
  if (ctx.trace !== null) ctx.trace.blocks.set(cell, node)
  if (joined) return cell
  const spans = node.spans!
  if (spans.length === 2) place(ctx, paragraph, spans[0]!, spans[1]!)
  // C2-A-149: a cell spans the text between its pipes.
  return place(ctx, cell, node.start + 1, node.end)
}

/**
 * The cells of one row with the cells of its span marks back at their columns (C2-A-092).
 * `covered` holds, per column, how many further rows a cell above still spans.
 */
function rowCells(ctx: TreeContext, row: BlockNode, covered: number[], rowEnd: number): AstNode[] {
  const cells: AstNode[] = []
  const takeCovered = (): void => {
    while (cells.length < covered.length && covered[cells.length]! > 0) {
      covered[cells.length]!--
      cells.push(coveredCell('rowspan'))
    }
  }
  for (const node of row.children!) {
    takeCovered()
    const cell = cellNode(ctx, node, rowEnd)
    const column = cells.length
    cells.push(cell)
    for (let more = 1; more < (cell.colspan ?? 1); more++) cells.push(coveredCell('colspan'))
    covered[column] = (cell.rowspan ?? 1) - 1
  }
  takeCovered()
  return cells
}

function rowNode(ctx: TreeContext, row: BlockNode, covered: number[]): AstNode {
  const lineEnd = ctx.src.indexOf('\n', row.start)
  const joined = lineEnd >= 0 && lineEnd < row.end
  const out: AstNode = { type: 'table_row', children: rowCells(ctx, row, covered, joined ? lineEnd : row.end + 1) }
  if (ctx.trace !== null) ctx.trace.blocks.set(out, row)
  if (row.aux !== 0) {
    // C2-B-167: the row attribute stands behind the closing pipe.
    const attributes = emptyAttributes()
    readGluedBlocks(ctx.src, row.aux, row.end, attributes)
    setAttributes(out, attributes)
  }
  // C2-A-158: a row that a continuation row joined has no position.
  return joined ? out : place(ctx, out, row.start, row.end)
}

function sortRows(ctx: TreeContext, node: BlockNode, comment: CommentBuilder): Groups {
  const headRows = node.facts & FACT_MASK
  const rowCount = node.children!.reduce((count, child) => count + (child.kind === COMMENT ? 0 : 1), 0)
  const footStart = rowCount - (node.facts >> FACT_SHIFT)
  const groups = emptyGroups()
  let covered: number[] = []
  let group = headRows > 0 ? groups.head : groups.body
  let index = 0
  let trailingEnd = 0
  for (const child of node.children!) {
    if (child.kind === COMMENT) {
      const out = comment(ctx, child)
      if (ctx.trace !== null) ctx.trace.blocks.set(out, child)
      groups.trailing.push(out)
      trailingEnd = child.end
      continue
    }
    // C2-A-086: a comment between two rows belongs to the group of the row above it.
    if (groups.trailing.length > 0) {
      for (const pending of groups.trailing) group.push(pending)
      extend(groups, group, child.start, trailingEnd)
      groups.trailing = []
    }
    // C2-B-174: a row span does not cross the head boundary.
    if (index === headRows) covered = []
    group = index < headRows ? groups.head : index < footStart ? groups.body : groups.foot
    const row = rowNode(ctx, child, covered)
    groups.width = Math.max(groups.width, row.children!.length)
    group.push(row)
    // A continuation row is no part of the range: a comment may stand between the row and it (C2-B-175).
    const lineEnd = ctx.src.indexOf('\n', child.start)
    extend(groups, group, child.start, lineEnd >= 0 && lineEnd < child.end ? lineEnd : child.end)
    index++
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

/** C2-A-089: one column per position up to the widest row, with what `aligns` and `widths` spell (C2-B-211, C2-B-212). */
function columnNodes(width: number, aligns: string | null, widths: string | null): AstNode[] {
  const alignList = aligns === null ? [] : aligns.split(',')
  const widthList = widths === null ? [] : widths.split(',')
  const columns: AstNode[] = []
  for (let at = 0; at < width; at++) {
    const column: AstNode = { type: 'table_column' }
    const align = (alignList[at] ?? '').trim()
    const fraction = columnWidth((widthList[at] ?? '').trim())
    if (ALIGN_WORDS.includes(align)) column.align = align
    if (fraction !== undefined) column.width = fraction
    if (column.align !== undefined || fraction !== undefined) column.authored = true
    columns.push(column)
  }
  return columns
}

function groupNode(ctx: TreeContext, groups: Groups, type: string, rows: AstNode[]): AstNode {
  const range = groups.ranges.get(rows)
  const group: AstNode = { type, children: rows }
  return range === undefined ? group : place(ctx, group, range[0], range[1])
}

/** C2-H-153: `aligns`, `widths`, `header-rows` and `footer-rows` are read here and are no attributes of the table. */
function tableOf(ctx: TreeContext, groups: Groups, attributes: Attributes | null): AstNode {
  takeKey(attributes, 'footer-rows')
  takeKey(attributes, 'header-rows')
  const table: AstNode = { type: 'table', columns: columnNodes(groups.width, takeKey(attributes, 'aligns'), takeKey(attributes, 'widths')), children: [] }
  if (groups.head.length > 0) table.children!.push(groupNode(ctx, groups, 'table_head', groups.head))
  if (groups.body.length > 0) table.children!.push(groupNode(ctx, groups, 'table_body', groups.body))
  if (groups.foot.length > 0) table.children!.push(groupNode(ctx, groups, 'table_foot', groups.foot))
  for (const pending of groups.trailing) table.children!.push(pending)
  setAttributes(table, attributes)
  return table
}

/** A pipe table. `comment` builds the node of a comment-only line between two rows. */
export function tableNode(ctx: TreeContext, node: BlockNode, comment: CommentBuilder): AstNode {
  return tableOf(ctx, sortRows(ctx, node, comment), readAttributeLines(ctx.src, node.attributes))
}

function delimitedRow(cells: string[], header: boolean): AstNode {
  return {
    type: 'table_row',
    children: cells.map((value) => ({
      type: 'table_cell', header,
      children: [{ type: 'cell_paragraph', children: value === '' ? [] : [{ type: 'text', value }] }],
    })),
  }
}

/** C2-B-180: a `csv` or `tsv` fence that the `table` attribute marks. Its cells are plain text with no position (C2-A-158). */
export function delimitedTableNode(ctx: TreeContext, node: BlockNode): AstNode {
  const source = readDelimitedTable(ctx.src, node)
  const rows = source.rows
  const attributes = readAttributeLines(ctx.src, node.attributes)
  takeKey(attributes, 'table')
  // C2-B-209: a count past the last row gives no head, and every cell is a header cell.
  const allHeaders = source.headRows > rows.length
  const head = allHeaders ? 0 : source.headRows
  // C2-B-187: the footer rows are counted among the rows below the head.
  const footer = Math.min(Math.max(0, countValue(takeKey(attributes, 'footer-rows'))), Math.max(0, rows.length - head))
  const groups = emptyGroups()
  rows.forEach((cells, index) => {
    groups.width = Math.max(groups.width, cells.length)
    const group = index < head ? groups.head : index < rows.length - footer ? groups.body : groups.foot
    group.push(delimitedRow(cells, allHeaders || index < head))
  })
  const table = tableOf(ctx, groups, attributes)
  // C2-A-088: a body whose partition the source declared carries `headRows`.
  if (source.declared) for (const group of table.children!) if (group.type === 'table_body') group.headRows = source.headRows
  return table
}
