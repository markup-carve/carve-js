import type { TableCell, TableRow } from './ast.js'

/**
 * One cell's place in the resolved grid: the counts the span walk produced, and
 * whether a marker was absorbed into the cell it extended.
 *
 * `align` and `valign` are filled in later by the HTML renderer, which resolves
 * them per column. They are declared here because the renderer carries one
 * object per cell rather than two.
 */
export interface SpanCell {
  row: TableRow
  cell: TableCell
  rowspan: number
  colspan: number
  skip: boolean
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
}

/**
 * PART 9 §13 T5, the span walk, as ONE implementation.
 *
 * It lived inside the HTML renderer, which was fine while HTML was the only
 * consumer of a resolved span. PART 12 §26 publishes the counts on the tree, so
 * the encoder needs the same answer - and a second copy of a normative total
 * function with an orphan case and a blocked case is the divergence carve#2190
 * exists to stop, whether the two copies are in two repositories or two files.
 *
 * A marker that finds no origin, or whose span would cover another cell, keeps
 * `skip: false` and its own counts of 1: T5 renders it as an empty cell rather
 * than dropping it, so it stays a cell of the grid.
 */
export function resolveTableSpans(rows: readonly TableRow[]): SpanCell[][] {
  const grid: SpanCell[][] = []
  for (const row of rows) {
    grid.push(row.cells.map((cell) => ({ row, cell, rowspan: 1, colspan: 1, skip: false })))
  }
  return resolveSpanGrid(grid, (entry) => (entry.cell.span === 'rowspan' ? '^' : entry.cell.span === 'colspan' ? '<' : null))
}

/** The fields the span walk reads and writes on a grid entry. */
export interface SpanEntry {
  rowspan: number
  colspan: number
  skip: boolean
}

/**
 * The T5 walk over any grid, so the pipe table and the list-table extension
 * resolve markers with one rule.
 */
export function resolveSpanGrid<T extends SpanEntry>(grid: T[][], markerOf: (entry: T) => '^' | '<' | null): T[][] {
  // Per position, the grid coordinates of the cell whose rectangle covers it,
  // so a marker resolves against its neighbor's cell in O(1). A span never
  // covers a position another cell owns (carve#3047).
  const cover: Array<Array<readonly [number, number] | undefined>> = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!
    const own: Array<readonly [number, number] | undefined> = (cover[r] = [])
    for (let c = 0; c < row.length; c++) {
      const entry = row[c]!
      // Already resolved into the row strip of a '^' to its left.
      if (entry.skip) continue
      const marker = markerOf(entry)
      if (marker === '<' && c > 0) {
        const at = own[c - 1]
        // Widening a cell that started in an earlier row would cover cells
        // already placed above.
        if (at && at[0] === r) {
          grid[r]![at[1]]!.colspan++
          entry.skip = true
          own[c] = at
          continue
        }
      } else if (marker === '^' && r > 0) {
        const at = cover[r - 1]?.[c]
        const src = at && at[1] === c ? grid[at[0]]![at[1]]! : undefined
        if (src && stripIsFree(row, c, src.colspan, markerOf)) {
          src.rowspan++
          for (let k = c; k < c + src.colspan; k++) {
            own[k] = at
            const strip = row[k]
            if (strip) strip.skip = true
          }
          continue
        }
      }
      own[c] = [r, c]
    }
  }
  return grid
}

/** The rest of a row strip a '^' would cover holds unresolved span markers or no cell. */
function stripIsFree<T extends SpanEntry>(row: readonly T[], c: number, colspan: number, markerOf: (entry: T) => '^' | '<' | null): boolean {
  for (let k = c + 1; k < c + colspan; k++) {
    const entry = row[k]
    if (entry && (entry.skip || markerOf(entry) === null)) return false
  }
  return true
}
