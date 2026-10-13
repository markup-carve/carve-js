import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, parse, renderCarve, renderHtml, SourceUnspellableError, type Document, type InlineNode, type Table, type TableCell, type TableRow } from '../src/index.js'

// `|` alone is prose and `||` is one empty cell (CARVE-P9-082), so a row with
// no cell has no spelling that keeps its cell count. The writer refuses it and
// the HTML importer drops it with a report instead of inventing a cell.

const cell = (value: string): TableCell =>
  ({ type: 'table_cell', header: false, children: value === '' ? [] : [{ type: 'text', value } as InlineNode] })
const row = (...cells: TableCell[]): TableRow => ({ type: 'table_row', cells })
const table = (...rows: TableRow[]): Document =>
  ({ type: 'document', children: [{ type: 'table', rows }] }) as unknown as Document

const drops = (html: string): Array<[string, string | undefined]> =>
  htmlToCarve(html).report.diagnostics.map((d) => [d.code, d.path])

describe('the Carve writer', () => {
  it('refuses a row with no cells', () => {
    const empty = row()
    let thrown: unknown
    try {
      renderCarve(table(empty, row(cell('a'))))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SourceUnspellableError)
    expect((thrown as SourceUnspellableError).nodeType).toBe('table_row')
    expect((thrown as SourceUnspellableError).node).toBe(empty)
  })

  it('still writes a row of one empty cell', () => {
    expect(renderCarve(table(row(cell('')), row(cell('a'))))).toBe('| |\n| a |\n')
  })
})

describe('the HTML importer', () => {
  it('drops a row with no cells and reports it', () => {
    const imported = htmlToCarve('<table><tr></tr><tr><td>a</td></tr></table>')
    expect(imported.value).toBe('| a |\n')
    expect(drops('<table><tr></tr><tr><td>a</td></tr></table>')).toStrictEqual([
      ['structure-unspellable', '/table[1]/tr[1]'],
    ])
    const written = parse(imported.value).children[0] as Table
    expect(written.rows.map((r) => r.cells.length)).toStrictEqual([1])
  })

  it('reports a table left without rows, caption included', () => {
    expect(htmlToCarve('<table><caption>c</caption><tr></tr></table><p>y</p>').value).toBe('y\n')
    expect(drops('<table><caption>c</caption><tr></tr></table><p>y</p>')).toContainEqual(['table-degraded', '/table[1]'])
  })

  it('keeps a row a rowspan fills', () => {
    const imported = htmlToCarve('<table><tr><td rowspan="2">a</td></tr><tr></tr></table>')
    expect(imported.value).toBe('| a |\n| ^ |\n')
    expect(imported.report.diagnostics).toStrictEqual([])
  })

  it.each([
    ['leading', '<tbody></tbody><tbody><tr></tr></tbody><tbody><tr><td>a</td></tr></tbody>', [0, 0, 1]],
    ['middle', '<tbody><tr><td>a</td></tr></tbody><tbody><tr></tr></tbody><tbody><tr><td>b</td></tr></tbody>', [1, 0, 1]],
    ['head and foot', '<thead><tr></tr></thead><tbody></tbody><tbody><tr><td>a</td></tr></tbody><tfoot><tr></tr></tfoot>', [0, 1]],
  ])('keeps the %s body counts of the rows that survive', (_, sections, counts) => {
    const written = parse(htmlToCarve(`<table>${sections}</table>`).value).children[0] as Table
    expect(written.rowGroups?.bodies.map((body) => body.bodyRows)).toStrictEqual(counts)
  })

  it.each([
    ['above', '<table><tr></tr><tr><th>H</th></tr><tr><td>a</td></tr></table>', '/table[1]/tr[1]', '|= H |\n| a |\n'],
    ['above, in a head', '<table><thead><tr></tr><tr><th>H</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>', '/table[1]/tr[1]', '|= H |\n| a |\n'],
    ['past a full-group rowspan, in the next group', '<table><thead><tr><th rowspan="0">H</th></tr></thead><tbody><tr></tr><tr><th>I</th></tr><tr><td>a</td></tr></tbody></table>', '/table[1]/tr[2]', '{header-rows=1 body-rows=1 body-header-rows=1}\n|= H |\n|= I |\n| a |\n'],
    ['inside', '<table><tr><th>H</th></tr><tr></tr><tr><th>I</th></tr><tr><td>a</td></tr></table>', '/table[1]/tr[2]', '|= H |\n|= I |\n| a |\n'],
  ])('leaves the header rows leading when a dropped row sits %s them', (_, html, dropped, carve) => {
    const imported = htmlToCarve(html)
    expect(imported.value).toBe(carve)
    // The same table without the empty row is the oracle.
    expect(imported.value).toBe(htmlToCarve(html.replace('<tr></tr>', '')).value)
    expect(imported.report.diagnostics.map((d) => [d.code, d.path])).toStrictEqual([['structure-unspellable', dropped]])
    expect(renderHtml(parse(imported.value)).split('</thead>')[0]).toContain('<th scope="col">H</th>')
  })

  it('keeps the row in the imported AST', () => {
    const imported = htmlToAst('<table><tr></tr><tr><td>a</td></tr></table>')
    expect((imported.value.children[0] as Table).rows.map((r) => r.cells.length)).toStrictEqual([0, 1])
  })
})
