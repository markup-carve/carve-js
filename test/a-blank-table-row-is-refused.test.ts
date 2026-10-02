import { describe, expect, it } from 'vitest'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'
import { htmlToAst, htmlToCarve, parse, renderCarve, renderHtml, SourceUnspellableError, type Document, type InlineNode, type TableCell, type TableRow } from '../src/index.js'

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
  it('reports the first refused row and all earlier row refusals as a batch', () => {
    const first = row(cell(''))
    const second = row(cell(''))
    const document = table(first, row(cell('x')), second)
    try {
      renderCarve(document)
      expect.fail('expected a row refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(SourceUnspellableError)
      expect((error as SourceUnspellableError).node).toBe(first)
      expect((error as SourceUnspellableError).nodes).toEqual([first, second])
    }
  })

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
  perfIt('drops repeated blank rows without retrying the whole writer per row', () => {
    expectScansLinearly((input) => void htmlToCarve(input), '<tr><td></td></tr>', {
      prefix: '<table>', suffix: '</table>', smallRepeats: 256, minSampleMs: 100,
    })
  }, 90000)

  perfIt('drops blank rows across many separate tables in one writer retry', () => {
    expectScansLinearly((input) => void htmlToCarve(input), '<table><tr><td></td></tr></table>', {
      smallRepeats: 256, minSampleMs: 100,
    })
  }, 90000)

  it('anchors an orphan caption to the last dropped row', () => {
    const result = htmlToCarve('<table><caption>c</caption><tr><td></td></tr><tr><td></td></tr></table>')
    expect(result.value).toBe('\n')
    expect(result.report.diagnostics.map((d) => [d.code, d.path])).toContainEqual([
      'element-dropped', '/table[1]/tr[2]',
    ])
  })

  it('does not batch a later table past an intervening inline refusal', () => {
    const html = '<table><tr><td></td></tr><tr><td><mark><mark>x</mark></mark></td></tr></table>'
      + '<table><tr><td></td></tr><tr><td></td></tr></table>'
    const result = htmlToCarve(html, { maxDiagnostics: 3 })
    expect(result.report.diagnostics.map((d) => d.path)).toEqual([
      '/table[1]/tr[1]', '/table[1]/tr[2]/td[1]/mark[1]/mark[1]', undefined,
    ])
  })

  it('keeps earlier row losses before a later inline refusal', () => {
    const html = '<table><tr><td></td></tr><tr><td><mark><mark>x</mark></mark></td></tr>'
      + '<tr><td></td></tr></table>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('| =x= |\n')
    expect(result.report.diagnostics.map((d) => d.path)).toEqual([
      '/table[1]/tr[1]', '/table[1]/tr[2]/td[1]/mark[1]/mark[1]', '/table[1]/tr[3]',
    ])
    expect(htmlToCarve(html, { maxDiagnostics: 2 }).report.diagnostics.map((d) => d.path)).toEqual([
      '/table[1]/tr[1]', undefined,
    ])
  })

  it('does not treat attribute records as table nodes', () => {
    const result = htmlToCarve('<p type="table">x</p><table><tr><td></td></tr></table>')
    expect(result.value).toContain('x')
  })

  it.each([
    ['<ul><li><table><tr><td></td></tr><tr><td>a</td></tr></table></li>'
      + '<li><mark><mark>x</mark></mark></li></ul>', 1],
    ['<table><caption><mark><mark>x</mark></mark></caption><tr><td></td></tr><tr><td>a</td></tr></table>', 0],
  ] as const)('keeps composite-block losses ahead of later table rows', (prefix, markIndex) => {
    const result = htmlToCarve(prefix + '<table><tr><td></td></tr><tr><td></td></tr></table>', { maxDiagnostics: 3 })
    expect(result.report.diagnostics[markIndex]?.message).toContain('Unwrapped <mark>')
    expect(result.report.diagnostics.at(-1)?.code).toBe('diagnostics-truncated')
  })

  it.each(['', '<tr><td>a</td></tr>'])('preserves refusals for blank rows in singleton figure targets', (surviving) => {
    expect(() => htmlToCarve('<figure><table><tr><td></td></tr>' + surviving
      + '</table><figcaption>c</figcaption></figure>')).toThrow(SourceUnspellableError)
  })

  it('keeps blank rows in the imported AST', () => {
    const result = htmlToAst('<table><tr><td></td></tr><tr><td>a</td></tr></table>')
    expect(result.value.children[0]).toMatchObject({ type: 'table', rows: [{}, {}] })
  })

  it('drops blank header rows while keeping the following data row', () => {
    const result = htmlToCarve('<table><thead><tr><th></th></tr><tr><th></th></tr></thead>'
      + '<tbody><tr><td>a</td></tr></tbody></table>')
    expect(result.value).toBe('| a |\n')
    expect(result.report.diagnostics.filter((d) => d.code === 'structure-unspellable').map((d) => d.path)).toEqual([
      '/table[1]/tr[1]', '/table[1]/tr[2]',
    ])
  })

  it('keeps loss paths and the diagnostic cap across interleaved rows', () => {
    const html = '<table><tr><td></td></tr><tr><td>a</td></tr>'
      + '<tr><td></td></tr><tr><td>b</td></tr><tr><td></td></tr></table>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('| a |\n| b |\n')
    expect(result.report.diagnostics.map((d) => d.path)).toEqual([
      '/table[1]/tr[1]', '/table[1]/tr[3]', '/table[1]/tr[5]',
    ])
    expect(htmlToCarve(html, { maxDiagnostics: 2 }).report.diagnostics.map((d) => d.path)).toEqual([
      '/table[1]/tr[1]', undefined,
    ])
  })

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
    expect(imported.report.diagnostics.map((d) => d.code)).toStrictEqual(['element-dropped', 'structure-unspellable'])
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
