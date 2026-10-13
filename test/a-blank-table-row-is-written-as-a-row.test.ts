import { describe, expect, it } from 'vitest'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'
import { htmlToAst, htmlToCarve, parse, renderCarve, renderHtml, SourceUnspellableError, type Document, type InlineNode, type Table, type TableCell, type TableRow } from '../src/index.js'

// A row of empty cells is a row (PART 9 CARVE-P9-082), so the writer spells it
// with one slot per cell (PART 11 CARVE-P11-014) and the HTML importer keeps
// it. Only a row with no cell at all has no spelling.

const cell = (value: string, extra: Partial<TableCell> = {}): TableCell =>
  ({ type: 'table_cell', header: false, children: value === '' ? [] : [{ type: 'text', value } as InlineNode], ...extra })
const header = (value: string): TableCell => ({ ...cell(value), header: true })
const row = (...cells: TableCell[]): TableRow => ({ type: 'table_row', cells })
const table = (...rows: TableRow[]): Document =>
  ({ type: 'document', children: [{ type: 'table', rows }] }) as unknown as Document

/** Row count, cells per row and each cell's kind and child count after a re-parse. */
const readBack = (carve: string): string[] => {
  const node = (parse(carve) as Document).children[0] as Table
  return node.rows.map((r) => r.cells.map((c) => `${c.header ? 'th' : 'td'}:${c.children?.length ?? 0}`).join(','))
}

describe('a table row whose every cell is blank', () => {
  it.each([
    ['a header row', table(row(header('')), row(cell('a'))), '|= |\n| a |\n', ['th:0', 'td:1']],
    ['a data row', table(row(cell('')), row(cell('a'))), '| |\n| a |\n', ['td:0', 'td:1']],
    ['several columns', table(row(cell(''), cell('')), row(cell('a'), cell('b'))), '| | |\n| a | b |\n', ['td:0,td:0', 'td:1,td:1']],
    ['a row between two filled ones', table(row(cell('a')), row(cell('')), row(cell('b'))), '| a |\n| |\n| b |\n', ['td:1', 'td:0', 'td:1']],
    ['a row carrying attributes', table({ ...row(cell('')), attrs: { classes: ['x'] } }, row(cell('a'))), '| |{.x}\n| a |\n', ['td:0', 'td:1']],
    ['a table of nothing else', table(row(cell('')), row(cell(''), cell(''))), '| |\n| | |\n', ['td:0', 'td:0,td:0']],
  ])('is written for %s and reads back as the same rows', (_, document, carve, rows) => {
    expect(renderCarve(document)).toBe(carve)
    expect(readBack(carve)).toStrictEqual(rows)
  })

  it.each([
    ['one filled cell', table(row(cell('a'), cell(''))), '| a | |\n'],
    ['a cell attribute', table(row(cell('', { attrs: { classes: ['x'] } })), row(cell('a'))), '|{.x} |\n| a |\n'],
    ['an alignment marker', table(row(cell('', { align: 'right' })), row(cell('a'))), '|> |\n| a |\n'],
    ['a span marker', table(row(cell('', { span: 'colspan' })), row(cell('a'))), '| < |\n| a |\n'],
  ])('is written for a row with %s', (_, document, carve) => {
    expect(renderCarve(document)).toBe(carve)
  })
})

describe('a table row with no cells', () => {
  it('is refused, the first such row named and every one batched', () => {
    const first = row()
    const second = row()
    try {
      renderCarve(table(first, row(cell('x')), second))
      expect.fail('expected a row refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(SourceUnspellableError)
      expect((error as SourceUnspellableError).nodeType).toBe('table_row')
      expect((error as SourceUnspellableError).node).toBe(first)
      expect((error as SourceUnspellableError).nodes).toEqual([first, second])
    }
  })

  it('is dropped by the HTML importer with a report', () => {
    const imported = htmlToCarve('<table><tr></tr><tr><td>a</td></tr></table>')
    expect(imported.value).toBe('| a |\n')
    expect(imported.report.diagnostics.map((d) => [d.code, d.path])).toStrictEqual([
      ['structure-unspellable', '/table[1]/tr[1]'],
    ])
  })
})

describe('the HTML importer', () => {
  perfIt('keeps repeated blank rows in linear time', () => {
    expectScansLinearly((input) => void htmlToCarve(input), '<tr><td></td></tr>', {
      prefix: '<table>', suffix: '</table>', smallRepeats: 256, minSampleMs: 100,
    })
  }, 90000)

  perfIt('keeps blank rows across many separate tables in linear time', () => {
    expectScansLinearly((input) => void htmlToCarve(input), '<table><tr><td></td></tr></table>', {
      smallRepeats: 256, minSampleMs: 100,
    })
  }, 90000)

  it.each([
    ['a blank header row', '<table><thead><tr><th></th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>', '|= |\n| a |\n'],
    ['two blank header rows', '<table><thead><tr><th></th></tr><tr><th></th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>', '|= |\n|= |\n| a |\n'],
    ['a blank data row', '<table><tr><td></td></tr><tr><td>a</td></tr></table>', '| |\n| a |\n'],
    ['several columns', '<table><tr><td></td><td></td></tr><tr><td>a</td><td>b</td></tr></table>', '| | |\n| a | b |\n'],
    ['a blank row between two filled ones', '<table><tr><td>a</td></tr><tr><td></td></tr><tr><td>b</td></tr></table>', '| a |\n| |\n| b |\n'],
    ['a table of blank rows only', '<table><tr><td></td></tr></table>', '| |\n'],
    ['a caption over blank rows', '<table><caption>c</caption><tr><td></td></tr><tr><td></td></tr></table>', '| |\n| |\n^ c\n'],
  ])('keeps %s, with no loss reported', (_, html, carve) => {
    const imported = htmlToCarve(html)
    expect(imported.value).toBe(carve)
    expect(imported.report.diagnostics).toStrictEqual([])
    expect(renderHtml(parse(imported.value))).toBe(renderHtml(htmlToAst(html).value))
  })

  it('keeps blank rows around an inline refusal and reports only the refusal', () => {
    const result = htmlToCarve('<table><tr><td></td></tr><tr><td><ins><ins>x</ins></ins></td></tr><tr><td></td></tr></table>')
    expect(result.value).toBe('| |\n| {+x+} |\n| |\n')
    expect(result.report.diagnostics.map((d) => d.path)).toEqual(['/table[1]/tr[2]/td[1]/ins[1]/ins[1]'])
  })

  it('keeps blank rows in the imported AST', () => {
    const result = htmlToAst('<table><tr><td></td></tr><tr><td>a</td></tr></table>')
    expect(result.value.children[0]).toMatchObject({ type: 'table', rows: [{}, {}] })
  })

  it('leaves a table whose row has one filled cell', () => {
    const imported = htmlToCarve('<table><tr><td>a</td><td></td></tr></table>')
    expect(imported.value).toBe('| a | |\n')
    expect(imported.report.diagnostics).toStrictEqual([])
    expect(renderHtml(parse(imported.value))).toBe('<table>\n  <tbody>\n    <tr><td>a</td><td></td></tr>\n  </tbody>\n</table>')
  })
})
