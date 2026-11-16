// C2-B-213 read backwards: a render writes on every cell the alignment it resolves from the cell, the head and the column.
import type { TableCellNode, TableColumnNode, TableNode } from '../../v2/src/index.ts'

type Align = NonNullable<TableCellNode['align']>
interface Placed { cell: TableCellNode, column: number, head: boolean }

/** The cells of `table` with the column each starts in, as a render places them (C2-H-056). */
function placed(table: TableNode): Placed[] {
  const result: Placed[] = []
  for (const group of table.children) {
    if (group.type === 'comment') continue
    const covered: number[] = []
    for (const row of group.children) if (row.type === 'table_row') placeRow(row.children, covered, group.type === 'table_head', result)
  }
  return result
}

function placeRow(cells: TableCellNode[], covered: number[], head: boolean, result: Placed[]): void {
  let column = 0
  for (const cell of cells) {
    while ((covered[column] ?? 0) > 0) covered[column] = (covered[column++] ?? 1) - 1
    result.push({ cell, column, head })
    const colspan = cell.colspan ?? 1
    for (let more = 0; more < colspan; more++) covered[column + more] = (cell.rowspan ?? 1) - 1
    column += colspan
  }
}

/** The mark of the last head cell that starts in each column (C2-B-213). */
function headMarks(cells: Placed[]): Map<number, Align> {
  const marks = new Map<number, Align>()
  for (const entry of cells) if (entry.head && entry.cell.align !== undefined) marks.set(entry.column, entry.cell.align)
  return marks
}

/** The alignment every cell of a column outside the head shares, where the head gives the column none. */
function sharedAlign(cells: Placed[]): Align | undefined {
  const first = cells[0]?.cell.align
  return first !== undefined && cells.every(entry => entry.cell.align === first) ? first : undefined
}

/**
 * A head cell keeps the alignment it shows as its own mark. A cell outside the head that shows the mark of its
 * column's head cell takes it from there. Without a head mark, a column whose cells all show one alignment has it
 * as its `aligns` entry; any other cell keeps its own (_SPEC_GAPS.md G4).
 */
export function resolveAlignments(table: TableNode): void {
  const cells = placed(table)
  const marks = headMarks(cells)
  const byColumn = new Map<number, Placed[]>()
  for (const entry of cells) {
    if (entry.head) continue
    const mark = marks.get(entry.column)
    if (mark !== undefined && entry.cell.align === mark) delete entry.cell.align
    else if (mark === undefined) byColumn.set(entry.column, [...byColumn.get(entry.column) ?? [], entry])
  }
  const hasHead = cells.some(entry => entry.head)
  for (const [index, entries] of byColumn) {
    const column: TableColumnNode | undefined = table.columns[index]
    const align = hasHead ? undefined : sharedAlign(entries)
    if (column === undefined || align === undefined) continue
    column.align = align
    column.authored = true
    for (const entry of entries) delete entry.cell.align
  }
}
