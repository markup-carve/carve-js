// C2-B-213 read backwards: a render writes on every cell the alignment it resolves from the cell, the head and the column.
import type { TableCellNode, TableNode } from '../../src/index.ts'

interface Placed { cell: TableCellNode, column: number, head: boolean }

/** The cells of a table's groups with the column each starts in, as a render places them (C2-H-056). */
function placed(groups: TableNode['children']): Placed[] {
  const result: Placed[] = []
  for (const group of groups) {
    if (group.type === 'comment') continue
    const freeAt: number[] = []
    let index = 0
    const head = group.type === 'table_head'
    for (const row of group.children) if (row.type === 'table_row') placeRow(row.children, freeAt, index++, head, result)
  }
  return result
}

/** `freeAt` holds, per column, the first row of the group that a row span from above no longer covers. */
function placeRow(cells: TableCellNode[], freeAt: number[], index: number, head: boolean, result: Placed[]): void {
  let column = 0
  for (const cell of cells) {
    while ((freeAt[column] ?? 0) > index) column++
    result.push({ cell, column, head })
    const colspan = cell.colspan ?? 1
    const end = index + (cell.rowspan ?? 1)
    for (let more = 0; more < colspan; more++) freeAt[column + more] = Math.max(freeAt[column + more] ?? 0, end)
    column += colspan
  }
}

/** C2-M-039: the columns a parse counts (C2-B-172), with the slots that row spans from above take in each row. */
export function gridWidth(groups: TableNode['children']): number {
  return placed(groups).reduce((width, entry) => Math.max(width, entry.column + (entry.cell.colspan ?? 1)), 0)
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
 * column's head cell takes it from there. In a table with no head, a column whose cells all show one alignment has it
 * as its `aligns` or `valigns` entry, but only while every column before it has one too, as the list has no empty
 * entry (C2-B-211); any other cell keeps its own. Each axis on its own (C2-M-040).
 */
export function resolveAlignments(table: TableNode): void {
  const cells = placed(table.children)
  resolveAxis(table, cells, 'align')
  resolveAxis(table, cells, 'valign')
}

function addEntry(byColumn: Map<number, Placed[]>, entry: Placed): void {
  const entries = byColumn.get(entry.column)
  if (entries === undefined) byColumn.set(entry.column, [entry])
  else entries.push(entry)
}

function resolveAxis(table: TableNode, cells: Placed[], axis: Axis): void {
  const marks = headMarks(cells, axis)
  const byColumn = new Map<number, Placed[]>()
  for (const entry of cells) {
    if (entry.head) continue
    const mark = marks.get(entry.column)
    if (mark !== undefined && entry.cell[axis] === mark) delete entry.cell[axis]
    else if (mark === undefined) addEntry(byColumn, entry)
  }
  if (cells.some(entry => entry.head)) return
  for (let index = 0; index < table.columns.length; index++) {
    const entries = byColumn.get(index) ?? []
    const value = sharedMark(entries, axis)
    // `baseline` has no `valigns` entry (C2-B-211), so its cells keep it, and so do the cells of every later column.
    if (value === undefined || value === 'baseline') return
    Object.assign(table.columns[index]!, { [axis]: value })
    for (const entry of entries) delete entry.cell[axis]
  }
}
