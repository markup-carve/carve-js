// C2-W-145: a span count that no mark cell covers, as an import or a bridge gives it (C2-A-093), is
// written with the marks a parse reads back as that count. The rows hold the added mark cells while
// the writer runs and get their own cells back after it.
import { forEachSlot, type Node, type TableCellNode, type TableNode, type TableRowNode } from './ast.ts'

export interface SpanMarks {
  /** The covering cell of each added mark, which a loss on the mark is reported at. */
  covering: Map<Node, TableCellNode>
  /** The cells whose row span has no spelling, as they also span more than one column. */
  unspelled: TableCellNode[]
  restore: () => void
}

function* cellsOf(table: TableNode): Generator<TableCellNode> {
  for (const group of table.children) {
    if (group.type === 'comment') continue
    for (const row of group.children) if (row.type === 'table_row') yield* row.children
  }
}

function implicitSpans(table: TableNode): boolean {
  let counts = false
  for (const cell of cellsOf(table)) {
    if (cell.span !== undefined) return false
    if ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1) counts = true
  }
  return counts
}

function mark(span: 'colspan' | 'rowspan', cell: TableCellNode, covering: Map<Node, TableCellNode>): TableCellNode {
  const added: TableCellNode = { type: 'table_cell', header: false, span, children: [] }
  covering.set(added, cell)
  return added
}

/** The cells of each row of one group with the marks of its counts, by the column counting of C2-B-172. */
function markRows(rows: readonly TableRowNode[], covering: Map<Node, TableCellNode>,
  unspelled: TableCellNode[]): TableCellNode[][] {
  // The row span from above that holds each column: its cell, the rows it still takes, and its width.
  const pending: { cell: TableCellNode, rows: number, width: number }[] = []
  return rows.map((row) => {
    const out: TableCellNode[] = []
    let column = 0
    const takePending = (): void => {
      for (let held = pending[column]; held !== undefined && held.rows > 0; held = pending[column]) {
        // A `^` below a cell of more than one column joins nothing, so that row span stays unspelled.
        if (held.width === 1) out.push(mark('rowspan', held.cell, covering))
        held.rows--
        column += held.width
      }
    }
    for (const cell of row.children) {
      takePending()
      out.push(cell)
      const colspan = cell.colspan ?? 1
      for (let at = 1; at < colspan; at++) out.push(mark('colspan', cell, covering))
      if ((cell.rowspan ?? 1) > 1) pending[column] = { cell, rows: cell.rowspan! - 1, width: colspan }
      if ((cell.rowspan ?? 1) > 1 && colspan > 1) unspelled.push(cell)
      column += colspan
    }
    takePending()
    // A row span that no cell of this row reaches has no place in it.
    for (let at = column; at < pending.length; at++) if ((pending[at]?.rows ?? 0) > 0) pending[at]!.rows--
    return out
  })
}

/** Adds the marks of C2-W-145 to every table of `document` that has counts and no mark cell, or null for none. */
export function addSpanMarks(document: Node): SpanMarks | null {
  const covering = new Map<Node, TableCellNode>()
  const unspelled: TableCellNode[] = []
  const undo: [TableRowNode, TableCellNode[]][] = []
  const stack: Node[] = [document]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === 'table' && implicitSpans(node)) {
      for (const group of node.children) {
        if (group.type === 'comment') continue
        const rows = group.children.filter((row): row is TableRowNode => row.type === 'table_row')
        markRows(rows, covering, unspelled).forEach((cells, at) => {
          const row = rows[at]!
          if (cells.length === row.children.length) return
          undo.push([row, row.children])
          row.children = cells
        })
      }
    }
    forEachSlot(node, (nodes) => { for (const child of nodes) stack.push(child) })
  }
  if (undo.length === 0 && unspelled.length === 0) return null
  return { covering, unspelled, restore: () => { for (const [row, cells] of undo) row.children = cells } }
}
