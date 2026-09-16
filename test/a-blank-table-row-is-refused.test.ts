import { describe, expect, it } from 'vitest'
import { htmlToCarve, parse, renderCarve, renderHtml, SourceUnspellableError, type Document, type InlineNode, type TableCell, type TableRow } from '../src/index.js'

// A row whose every cell is blank is not a table row (markup-carve/carve#1954),
// so the writer refuses the tree and the HTML importer drops the row
// (carve-js#1822).

const cell = (value: string, extra: Partial<TableCell> = {}): TableCell =>
  ({ type: 'table_cell', header: false, children: value === '' ? [] : [{ type: 'text', value } as InlineNode], ...extra })
const header = (value: string): TableCell => ({ ...cell(value), header: true })
const row = (...cells: TableCell[]): TableRow => ({ type: 'table_row', cells })
const table = (...rows: TableRow[]): Document =>
  ({ type: 'document', children: [{ type: 'table', rows }] }) as unknown as Document

describe('a table row whose every cell is blank', () => {
  it.each([
    ['a header row', table(row(header('')), row(cell('a')))],
    ['a data row', table(row(cell('')), row(cell('a')))],
    ['several columns', table(row(cell(''), cell('')), row(cell('a'), cell('b')))],
    ['a row between two filled ones', table(row(cell('a')), row(cell('')), row(cell('b')))],
    ['a row carrying attributes', table({ ...row(cell('')), attrs: { classes: ['x'] } }, row(cell('a')))],
  ])('is refused for %s', (_, document) => {
    let thrown: unknown
    try {
      renderCarve(document)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SourceUnspellableError)
    expect((thrown as SourceUnspellableError).nodeType).toBe('table_row')
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

describe('the HTML importer', () => {
  it.each([
    ['a blank header row', '<table><thead><tr><th></th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>', '| a |\n', '/table[1]/tr[1]'],
    ['a blank data row', '<table><tr><td></td></tr><tr><td>a</td></tr></table>', '| a |\n', '/table[1]/tr[1]'],
    ['several columns', '<table><tr><td></td><td></td></tr><tr><td>a</td><td>b</td></tr></table>', '| a | b |\n', '/table[1]/tr[1]'],
    ['a blank row between two filled ones', '<table><tr><td>a</td></tr><tr><td></td></tr><tr><td>b</td></tr></table>', '| a |\n| b |\n', '/table[1]/tr[2]'],
  ])('drops %s and keeps the table', (_, html, carve, path) => {
    const imported = htmlToCarve(html)
    expect(imported.value).toBe(carve)
    expect(imported.report.diagnostics.map((d) => [d.code, d.path, d.severity, d.fidelity])).toContainEqual([
      'structure-unspellable',
      path,
      'warning',
      'dropped',
    ])
  })

  it('drops the table when no row survives', () => {
    const imported = htmlToCarve('<table><tr><td></td></tr></table>')
    expect(imported.value).toBe('\n')
    expect(imported.report.diagnostics.map((d) => d.code)).toStrictEqual(['structure-unspellable'])
  })

  it('reports the caption of a table no row survives in', () => {
    const imported = htmlToCarve('<table><caption>c</caption><tr><td></td></tr></table>')
    expect(imported.value).toBe('\n')
    expect(imported.report.diagnostics.map((d) => d.code)).toStrictEqual(['structure-unspellable', 'element-dropped'])
  })

  it('keeps a caption whose table still has a row', () => {
    expect(htmlToCarve('<table><caption>c</caption><tr><td></td></tr><tr><td>a</td></tr></table>').value).toBe('| a |\n^ c\n')
  })

  it('leaves a table whose row has one filled cell', () => {
    const imported = htmlToCarve('<table><tr><td>a</td><td></td></tr></table>')
    expect(imported.value).toBe('| a | |\n')
    expect(imported.report.diagnostics).toStrictEqual([])
    expect(renderHtml(parse(imported.value))).toBe('<table>\n  <tbody>\n    <tr><td>a</td><td></td></tr>\n  </tbody>\n</table>')
  })
})
