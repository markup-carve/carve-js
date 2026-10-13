import { describe, expect, it } from 'vitest'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'
import { htmlToCarve, parse, renderCarve, renderHtml, type Document, type InlineNode, type Table, type TableCell, type TableRow } from '../src/index.js'

// A row whose every cell is blank is a table row (CARVE-P9-082), so the writer
// spells it with one explicit slot per cell (CARVE-P11-014) and the HTML
// importer keeps it.

const cell = (value: string, extra: Partial<TableCell> = {}): TableCell =>
  ({ type: 'table_cell', header: false, children: value === '' ? [] : [{ type: 'text', value } as InlineNode], ...extra })
const header = (value: string, extra: Partial<TableCell> = {}): TableCell => ({ ...cell(value, extra), header: true })
const row = (...cells: TableCell[]): TableRow => ({ type: 'table_row', cells })
const table = (...rows: TableRow[]): Document =>
  ({ type: 'document', children: [{ type: 'table', rows }] }) as unknown as Document

const classes = (attrs: { classes?: string[] } | undefined) => attrs?.classes

/** Row count, then per row its cells' kind, alignment, classes and child count. */
const tableShape = (document: Document) => {
  const node = document.children[0] as Table
  return node.rows.map((r) => ({
    classes: classes(r.attrs),
    cells: r.cells.map((c) => ({ header: c.header, align: c.align, classes: classes(c.attrs), children: c.children?.length })),
  }))
}

describe('a table row whose every cell is blank', () => {
  it.each([
    ['one data cell', table(row(cell(''))), '| |\n'],
    ['two data cells', table(row(cell(''), cell(''))), '| | |\n'],
    ['three data cells', table(row(cell(''), cell(''), cell(''))), '| | | |\n'],
    ['a header cell', table(row(header(''))), '|= |\n'],
    ['a header row above a body row', table(row(header('')), row(cell('a'))), '|= |\n| a |\n'],
    ['a row between two filled ones', table(row(cell('a')), row(cell('')), row(cell('b'))), '| a |\n| |\n| b |\n'],
    ['a row carrying attributes', table({ ...row(cell('')), attrs: { classes: ['x'] } }, row(cell('a'))), '| |{.x}\n| a |\n'],
    ['a marked empty cell', table(row(header('', { align: 'center', attrs: { classes: ['x'] } }))), '|=~{.x} |\n'],
    ['an alignment marker', table(row(cell('', { align: 'right' })), row(cell('a'))), '|> |\n| a |\n'],
  ])('is written as a row for %s, and reads back the same', (_, document, carve) => {
    const written = renderCarve(document)
    expect(written).toBe(carve)
    const reread = parse(written)
    expect(tableShape(reread)).toStrictEqual(tableShape(document))
    expect(renderCarve(reread)).toBe(written)
  })

  it.each([
    ['one filled cell', table(row(cell('a'), cell(''))), '| a | |\n'],
    ['a cell attribute', table(row(cell('', { attrs: { classes: ['x'] } })), row(cell('a'))), '|{.x} |\n| a |\n'],
    ['a span marker', table(row(cell('', { span: 'colspan' })), row(cell('a'))), '| < |\n| a |\n'],
  ])('is unchanged for a row with %s', (_, document, carve) => {
    expect(renderCarve(document)).toBe(carve)
  })
})

describe('the HTML importer', () => {
  perfIt('writes repeated blank rows linearly', () => {
    expectScansLinearly((input) => void htmlToCarve(input), '<tr><td></td></tr>', {
      prefix: '<table>', suffix: '</table>', smallRepeats: 256, minSampleMs: 100,
    })
  }, 90000)

  it.each([
    ['a lone blank data row', '<table><tr><td></td></tr></table>', '| |\n'],
    ['a blank header row', '<table><thead><tr><th></th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>', '|= |\n| a |\n'],
    ['two blank header rows', '<table><thead><tr><th></th></tr><tr><th></th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>', '|= |\n|= |\n| a |\n'],
    ['several columns', '<table><tr><td></td><td></td></tr><tr><td>a</td><td>b</td></tr></table>', '| | |\n| a | b |\n'],
    ['a blank row between two filled ones', '<table><tr><td>a</td></tr><tr><td></td></tr><tr><td>b</td></tr></table>', '| a |\n| |\n| b |\n'],
    ['a table of blank rows with a caption', '<table><caption>c</caption><tr><td></td></tr><tr><td></td></tr></table>', '| |\n| |\n^ c\n'],
  ])('keeps %s', (_, html, carve) => {
    const imported = htmlToCarve(html)
    expect(imported.value).toBe(carve)
    expect(imported.report.diagnostics).toStrictEqual([])
  })

  it('keeps the rows around a refused inline span', () => {
    const result = htmlToCarve('<table><tr><td></td></tr><tr><td><ins><ins>x</ins></ins></td></tr><tr><td></td></tr></table>')
    expect(result.value).toBe('| |\n| {+x+} |\n| |\n')
    expect(result.report.diagnostics.map((d) => d.path)).toEqual(['/table[1]/tr[2]/td[1]/ins[1]/ins[1]'])
  })

  it('leaves a table whose row has one filled cell', () => {
    const imported = htmlToCarve('<table><tr><td>a</td><td></td></tr></table>')
    expect(imported.value).toBe('| a | |\n')
    expect(imported.report.diagnostics).toStrictEqual([])
    expect(renderHtml(parse(imported.value))).toBe('<table>\n  <tbody>\n    <tr><td>a</td><td></td></tr>\n  </tbody>\n</table>')
  })
})
