// C2-B-213 read backwards: a render writes on every cell the alignment it resolves from the cell, the head and the column.
import type { TableCellNode, TableColumnNode, TableNode } from '../../v2/src/index.ts'

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

type Axis = 'align' | 'valign'

/** The mark of the last head cell that starts in each column, on one axis (C2-B-213). */
function headMarks(cells: Placed[], axis: Axis): Map<number, string> {
  const marks = new Map<number, string>()
  for (const entry of cells) {
    const mark = entry.cell[axis]
    if (entry.head && mark !== undefined) marks.set(entry.column, mark)
  }
  return marks
}

/** The alignment every cell of a column outside the head shares on one axis, where the head gives the column none. */
function sharedMark(cells: Placed[], axis: Axis): string | undefined {
  const first = cells[0]?.cell[axis]
  return first !== undefined && cells.every(entry => entry.cell[axis] === first) ? first : undefined
}

/**
 * A head cell keeps the alignment it shows as its own mark. A cell outside the head that shows the mark of its
 * column's head cell takes it from there. Without a head mark, a column whose cells all show one alignment has it
 * as its `aligns` or `valigns` entry; any other cell keeps its own (_SPEC_GAPS.md G4). Each axis on its own (C2-M-040).
 */
export function resolveAlignments(table: TableNode): void {
  const cells = placed(table)
  resolveAxis(table, cells, 'align')
  resolveAxis(table, cells, 'valign')
}

function resolveAxis(table: TableNode, cells: Placed[], axis: Axis): void {
  const marks = headMarks(cells, axis)
  const byColumn = new Map<number, Placed[]>()
  for (const entry of cells) {
    if (entry.head) continue
    const mark = marks.get(entry.column)
    if (mark !== undefined && entry.cell[axis] === mark) delete entry.cell[axis]
    else if (mark === undefined) byColumn.set(entry.column, [...byColumn.get(entry.column) ?? [], entry])
  }
  const hasHead = cells.some(entry => entry.head)
  for (const [index, entries] of byColumn) {
    const column: TableColumnNode | undefined = table.columns[index]
    const value = hasHead ? undefined : sharedMark(entries, axis)
    // `baseline` has no `valigns` entry (C2-B-211), so its cells keep it.
    if (column === undefined || value === undefined || value === 'baseline') continue
    Object.assign(column, { [axis]: value })
    for (const entry of entries) delete entry.cell[axis]
  }
}
