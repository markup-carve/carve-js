import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, toAstJson } from '../src/index.js'
import { resolveTableSpans } from '../src/table-spans.js'

const cellsOf = (source: string) => {
  const tree = carveToAstJson(source) as unknown as {
    children: Array<{ rows: Array<{ cells: Array<Record<string, unknown>> }> }>
  }
  return tree.children[0]!.rows.map((row) =>
    row.cells.map((cell) => ({ span: cell['span'], colspan: cell['colspan'], rowspan: cell['rowspan'] })),
  )
}

describe('PART 12 §26: a spanning cell publishes its resolved extent', () => {
  it('puts the counts on the origin and leaves the markers where the author wrote them', () => {
    expect(cellsOf('| a | < | b |\n| ^ | c | d |\n')).toEqual([
      [
        { span: undefined, colspan: 2, rowspan: 2 },
        { span: 'colspan', colspan: undefined, rowspan: undefined },
        { span: undefined, colspan: undefined, rowspan: undefined },
      ],
      [
        { span: 'rowspan', colspan: undefined, rowspan: undefined },
        { span: undefined, colspan: undefined, rowspan: undefined },
        { span: undefined, colspan: undefined, rowspan: undefined },
      ],
    ])
  })

  it('emits no count for a cell that spans one row and one column', () => {
    for (const cell of cellsOf('| a | b |\n')[0]!) {
      expect(cell.colspan).toBeUndefined()
      expect(cell.rowspan).toBeUndefined()
    }
  })

  it('gives a marker that found no origin no count, and keeps it a cell', () => {
    // T5 is total: a `^` in the first row and a `<` in the first column find
    // nothing, render as empty cells, and extend nobody.
    const rows = cellsOf('| ^ | a |\n')
    expect(rows[0]![0]).toEqual({ span: 'rowspan', colspan: undefined, rowspan: undefined })
    expect(rows[0]![1]!.colspan).toBeUndefined()
  })

  it('renders the same HTML the walk produced before it was shared', () => {
    expect(carveToHtml('| a | < | b |\n| ^ | c | d |\n')).toContain('rowspan="2" colspan="2"')
  })

  it('survives its own ingest and is re-emitted rather than dropped', () => {
    const tree = carveToAstJson('| a | < | b |\n| ^ | c | d |\n')
    const again = toAstJson(fromAstJson(JSON.parse(JSON.stringify(tree)))) as unknown as {
      children: Array<{ rows: Array<{ cells: Array<Record<string, unknown>> }> }>
    }
    expect(again.children[0]!.rows[0]!.cells[0]).toMatchObject({ colspan: 2, rowspan: 2 })
  })

  it('does not recompute a count an ingested tree already carries', () => {
    // §23's rule for `blockImage`, one field over: an importer may have resolved
    // a span from markers this engine never saw, so a present count wins.
    const tree = {
      type: 'document',
      srcByteLength: 0,
      children: [
        {
          type: 'table',
          rows: [
            { type: 'table_row', cells: [{ type: 'table_cell', header: false, children: [], colspan: 3 }] },
          ],
        },
      ],
    }
    const again = toAstJson(fromAstJson(tree as never)) as unknown as {
      children: Array<{ rows: Array<{ cells: Array<Record<string, unknown>> }> }>
    }
    expect(again.children[0]!.rows[0]!.cells[0]!['colspan']).toBe(3)
  })

  it('exposes one implementation of the walk', () => {
    const grid = resolveTableSpans([
      {
        type: 'table_row',
        cells: [
          { type: 'table_cell', header: false, children: [] },
          { type: 'table_cell', header: false, children: [], span: 'colspan' },
        ],
      },
    ] as never)
    expect(grid[0]![0]!.colspan).toBe(2)
    expect(grid[0]![1]!.skip).toBe(true)
  })
})
