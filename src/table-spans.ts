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
 * A marker that finds no origin keeps `skip: false` and its own counts of 1: T5
 * renders it as an empty cell rather than dropping it, so it stays a cell of the
 * grid.
 */
export function resolveTableSpans(rows: readonly TableRow[]): SpanCell[][] {
  const grid: SpanCell[][] = []
  for (const row of rows) {
    grid.push(row.cells.map((cell) => ({ row, cell, rowspan: 1, colspan: 1, skip: false })))
  }

  // Per column, the last row index (above the current one) a '^' resolves
  // against. Maintained incrementally so a '^' resolves in O(1) instead of
  // walking up every prior row (an all-'^' table was O(rows^2)).
  const base: number[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      const entry = grid[r]![c]!
      if (entry.skip) continue
      if (entry.cell.span === 'rowspan' && r > 0) {
        const up = base[c]
        const src = up !== undefined ? grid[up]?.[c] : undefined
        if (src) {
          // A '^' standing under a merged '<' is ABSORBED: it renders nothing.
          // A cell spanning both ways carries a mark into each column it
          // covers, and the origin's rowspan is grown by the mark at the
          // origin's own index; the count this one adds lands on the merged
          // '<', which renders nothing either, so it is discarded with it. (A
          // branch skipping the increment was here and no mutation of it could
          // change an output.) Before this, such a mark found no source at all
          // and rendered an empty cell, putting a `<td>` in a row the spans
          // above it already cover.
          src.rowspan++
          entry.skip = true
        }
      } else if (entry.cell.span === 'colspan' && c > 0) {
        let left = c - 1
        while (left >= 0 && grid[r]![left]!.skip) left--
        const src = grid[r]![left]
        if (src) {
          src.colspan++
          entry.skip = true
        }
      }
      // Any cell that is not a RESOLVED '^' is what the cells below it in this
      // column resolve against - a merged '<' included, because the column it
      // covers is still a column of the grid.
      if (!entry.skip || entry.cell.span === 'colspan') base[c] = r
    }
  }
  return grid
}
