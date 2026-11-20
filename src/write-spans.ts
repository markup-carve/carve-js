// C2-W-145: a span count that no mark cell covers, as an import or a bridge gives it (C2-A-093), is
// written with the marks a parse reads back as that count. Marks the tree already holds stay as they
// are. The rows hold the added mark cells while the writer runs and get their own cells back after it.
import { forEachSlot, type Node, type TableCellNode, type TableNode, type TableRowNode } from './ast.ts'

export interface SpanMarks {
  /** The covering cell of each added mark, which a loss on the mark is reported at. */
  covering: Map<Node, TableCellNode>
  /** The cells whose row span has no spelling, as they also span more than one column. */
  unspelled: TableCellNode[]
  restore: () => void
}

/** A row span from above that holds a column: its cell, the rows it still takes, its width, and whether the tree holds its marks. */
interface Pending {
  cell: TableCellNode
  rows: number
  width: number
  marked: boolean | undefined
}

function hasCounts(table: TableNode): boolean {
  for (const group of table.children) {
    if (group.type === 'comment') continue
    for (const row of group.children) {
      if (row.type === 'table_row' && row.children.some((cell) => (cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1)) return true
    }
  }
  return false
}

function mark(span: 'colspan' | 'rowspan', cell: TableCellNode, covering: Map<Node, TableCellNode>): TableCellNode {
  const added: TableCellNode = { type: 'table_cell', header: false, span, children: [] }
  covering.set(added, cell)
  return added
}

/** Whether the `colspan - 1` cells behind `cells[at]` are its marks. */
function markedColumns(cells: readonly TableCellNode[], at: number, colspan: number): boolean {
  for (let k = 1; k < colspan; k++) if (cells[at + k]?.span !== 'colspan') return false
  return true
}

class GroupMarks {
  private readonly pending: Pending[] = []
  private out: TableCellNode[] = []
  private column = 0
  private added = false

  private readonly covering: Map<Node, TableCellNode>
  private readonly unspelled: TableCellNode[]

  constructor(covering: Map<Node, TableCellNode>, unspelled: TableCellNode[]) {
    this.covering = covering
    this.unspelled = unspelled
  }

  /** The cells of `row` with the marks of its counts, by the column counting of C2-B-172, or null where it needs none. */
  row(row: TableRowNode): TableCellNode[] | null {
    this.out = []
    this.column = 0
    this.added = false
    const cells = row.children
    for (let at = 0; at < cells.length; at++) this.place(cells, at)
    this.takePending(undefined)
    // A row span that no cell of this row reaches has no place in it.
    for (let at = this.column; at < this.pending.length; at++) if ((this.pending[at]?.rows ?? 0) > 0) this.pending[at]!.rows--
    return this.added ? this.out : null
  }

  private place(cells: readonly TableCellNode[], at: number): void {
    const cell = cells[at]!
    this.takePending(cell)
    this.out.push(cell)
    const held = this.pending[this.column]
    if (cell.span === 'rowspan' && held?.marked === true) held.rows--
    const colspan = cell.colspan ?? 1
    const marked = cell.span !== undefined || colspan === 1 || markedColumns(cells, at, colspan)
    if (!marked) {
      for (let k = 1; k < colspan; k++) this.out.push(mark('colspan', cell, this.covering))
      this.added = true
    }
    if ((cell.rowspan ?? 1) > 1) this.pending[this.column] = { cell, rows: cell.rowspan! - 1, width: colspan, marked: undefined }
    this.column += marked ? 1 : colspan
  }

  /** The marks of the row spans from above at the column, before the cell `next` of the row. */
  private takePending(next: TableCellNode | undefined): void {
    for (let held = this.pending[this.column]; held !== undefined && held.rows > 0; held = this.pending[this.column]) {
      // The first row below a count tells whether the tree holds its marks.
      held.marked ??= next?.span === 'rowspan'
      if (held.marked) return
      // A `^` below a cell of more than one column joins nothing, so that row span stays unspelled.
      if (held.width === 1) {
        this.out.push(mark('rowspan', held.cell, this.covering))
        this.added = true
      } else if (!this.unspelled.includes(held.cell)) this.unspelled.push(held.cell)
      held.rows--
      this.column += held.width
    }
  }
}

function markTable(table: TableNode, covering: Map<Node, TableCellNode>, unspelled: TableCellNode[],
  undo: [TableRowNode, TableCellNode[]][]): void {
  for (const group of table.children) {
    if (group.type === 'comment') continue
    const marks = new GroupMarks(covering, unspelled)
    for (const row of group.children) {
      const cells = row.type === 'table_row' ? marks.row(row) : null
      if (cells === null || row.type !== 'table_row') continue
      undo.push([row, row.children])
      row.children = cells
    }
  }
}

/** Adds the marks of C2-W-145 to every table of `document` whose counts lack them, or null for none. */
export function addSpanMarks(document: Node): SpanMarks | null {
  const covering = new Map<Node, TableCellNode>()
  const unspelled: TableCellNode[] = []
  const undo: [TableRowNode, TableCellNode[]][] = []
  const stack: Node[] = [document]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === 'table' && hasCounts(node)) markTable(node, covering, unspelled, undo)
    forEachSlot(node, (nodes) => { for (const child of nodes) stack.push(child) })
  }
  if (undo.length === 0 && unspelled.length === 0) return null
  return { covering, unspelled, restore: () => { for (const [row, cells] of undo) row.children = cells } }
}
