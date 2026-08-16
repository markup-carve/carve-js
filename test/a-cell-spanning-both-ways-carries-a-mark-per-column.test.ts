import { describe, expect, it } from 'vitest'

import { carveToHtml, htmlToAst, htmlToCarve, listTable } from '../src/index.js'

/**
 * A cell that spans BOTH ways carries a mark into EACH column it covers, and a
 * `^` standing under a resolved `<` is absorbed by the origin that `<` merged
 * into.
 *
 * The renderer resolves a `^` against the cell at the SAME INDEX above it, so a
 * `<td colspan="2" rowspan="2">` written with ONE mark for its origin left the
 * next rowspan in the row resolving against a column it does not own: the gap
 * between the two marks was filled with a cell the source did not have,
 * reported as an invention, and rendered as a `<td>` the table does not have.
 *
 * Writing a mark per column is only half of it. A `^` in the second column of a
 * two-column origin has a merged `<` above it, and that one used to resolve to
 * nothing at all and render an empty cell - so the same phantom `<td>` came out
 * of HAND-WRITTEN `| A | < |` over `| ^ | ^ |`, with no import involved. Both
 * halves are pinned below.
 */

const written = (html: string): string => htmlToCarve(html, { mode: 'semantic' }).value
const codes = (html: string): string[] =>
  htmlToCarve(html, { mode: 'semantic' }).report.diagnostics.map((diagnostic) => diagnostic.code)
const table = (html: string): Record<string, unknown> =>
  htmlToAst(html, { mode: 'semantic' }).value.children[0] as unknown as Record<string, unknown>

describe('a cell spanning both ways', () => {
  it('carries a mark into each column it covers, so the row it covers renders empty', () => {
    const html =
      '<table><tr><td colspan="2" rowspan="2">A</td><td rowspan="2">B</td></tr><tr></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>'
    expect(written(html)).toBe('| A | < | B |\n| ^ | ^ | ^ |\n| 1 | 2 | 3 |\n')
    // The row every span above it covers has no cells of its own, and gains
    // none: one mark for the origin put a `<td>` here.
    expect(carveToHtml(written(html))).toContain('<tr></tr>')
    expect(carveToHtml(written(html))).toContain(
      '<tr><td rowspan="2" colspan="2">A</td><td rowspan="2">B</td></tr>',
    )
    // And nothing was invented, so nothing is reported.
    expect(codes(html)).toEqual([])
  })

  it('leaves the cells after it in the row on the columns they came from', () => {
    const html =
      '<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td colspan="2" rowspan="2">X</td><td>c</td></tr><tr><td>f</td></tr></table>'
    expect(written(html)).toBe('|= a |= b |= c |\n| X | < | c |\n| ^ | ^ | f |\n')
    expect(carveToHtml(written(html))).toContain('<tr><td rowspan="2" colspan="2">X</td><td>c</td></tr>')
    expect(carveToHtml(written(html))).toContain('<tr><td>f</td></tr>')
    expect(codes(html)).toEqual([])
  })

  it('renders nothing for a hand-written `^` under a merged `<`', () => {
    // No import: this is what the two marks mean on their own.
    expect(carveToHtml('| A | < |\n| ^ | ^ |\n')).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td rowspan="2" colspan="2">A</td></tr>',
        '    <tr></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('counts the columns it covers as row heads', () => {
    const html =
      '<table><thead><tr><th>h1</th><th>h2</th><th>h3</th></tr></thead><tbody><tr><th colspan="2" rowspan="2">R</th><td>1</td></tr><tr><td>2</td></tr></tbody><tfoot><tr><td>f</td><td>g</td><td>h</td></tr></tfoot></table>'
    expect((table(html).rowGroups as { bodies: Array<Record<string, unknown>> }).bodies).toEqual([
      { headRows: 0, bodyRows: 2, rowHeadColumns: 2 },
    ])
  })

  it('counts them by the `<` above them, not by the row two above', () => {
    // The count is the MINIMUM over the group's rows, so an over-count in the
    // covered row only surfaces where that row is the minimum: `R` and `S` make
    // three row-head columns in the first row, and the second has only the two
    // `R` covers.
    const html =
      '<table><thead><tr><th>h1</th><th>h2</th><th>h3</th><th>h4</th></tr></thead><tbody><tr><th colspan="2" rowspan="2">R</th><th>S</th><td>1</td></tr><tr><td>2</td><td>3</td></tr></tbody><tfoot><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></tfoot></table>'
    expect((table(html).rowGroups as { bodies: Array<Record<string, unknown>> }).bodies).toEqual([
      { headRows: 0, bodyRows: 2, rowHeadColumns: 2 },
    ])
  })

  it('reads the header flag off the `<` above, whatever the row two above holds', () => {
    // The `^` in the second column has a `<` above it, and THAT one already
    // carries `R`'s header flag. Walking past it to the row above `R` read a
    // data cell and dropped the column from the count - which the shape above
    // cannot show, because a head row is a header in every column.
    const html =
      '<table><tbody><tr><td>d1</td><td>d2</td><td>d3</td></tr></tbody><tbody><tr><th colspan="2" rowspan="2">R</th><td>1</td></tr><tr><td>2</td></tr></tbody></table>'
    expect((table(html).rowGroups as { bodies: Array<Record<string, unknown>> }).bodies).toEqual([
      { headRows: 0, bodyRows: 1 },
      { headRows: 0, bodyRows: 2, rowHeadColumns: 2 },
    ])
  })

  it('resolves the same way in a list-table as in the equivalent pipe table', () => {
    const rows = [
      ['A', '<', 'B'],
      ['^', '^', '^'],
    ]
    const list = ['::: list-table', ...rows.flatMap((row) => row.map((cell, i) => (i === 0 ? '- - ' : '  - ') + cell)), ':::'].join('\n')
    const pipe = rows.map((row) => '| ' + row.join(' | ') + ' |').join('\n')
    // Compared RAW. Stripping the pure-empty padding cells the list-table adds
    // to a ragged grid - which other span tests here do - hides exactly the
    // defect: the phantom `<td>` an unabsorbed `^` renders is a pure-empty cell
    // too, and the two outputs match once it is stripped away. They match
    // without stripping now, so the comparison is the assertion.
    expect(carveToHtml(list, { extensions: [listTable()] })).toContain(
      '<tr><td rowspan="2" colspan="2">A</td><td rowspan="2">B</td></tr>\n    <tr></tr>',
    )
    expect(carveToHtml(list, { extensions: [listTable()] })).toBe(carveToHtml(pipe))
  })
})

describe('the spans a mark per column does not change', () => {
  it('writes one `<` per further column of a plain colspan', () => {
    const html = '<table><tr><th>a</th><th>b</th></tr><tr><td colspan="2">wide</td></tr></table>'
    expect(written(html)).toBe('|= a |= b |\n| wide | < |\n')
    expect(carveToHtml(written(html))).toContain('<td colspan="2">wide</td>')
    expect(codes(html)).toEqual([])
  })

  it('writes one `^` per further row of a plain rowspan', () => {
    const html = '<table><tr><td rowspan="3">deep</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>'
    expect(written(html)).toBe('| deep | 1 |\n| ^ | 2 |\n| ^ | 3 |\n')
    expect(carveToHtml(written(html))).toContain('<td rowspan="3">deep</td>')
    expect(codes(html)).toEqual([])
  })

  it('still reports the cell it invents for a row that is genuinely short', () => {
    // The gap here is the source's: nothing covers the first column of row 2.
    const html = '<table><tr><td>A</td><td rowspan="2">B</td></tr><tr></tr></table>'
    expect(written(html)).toBe('| A | B |\n| | ^ |\n')
    expect(codes(html)).toEqual(['table-degraded'])
  })

  it('still renders an orphan `^` as an empty cell', () => {
    // Nothing above it to continue, in any column.
    expect(carveToHtml('| ^ | a |\n')).toContain('<tr><td></td><td>a</td></tr>')
  })

  it('still resolves a `^` under a merged `<` in a LATER row against that row', () => {
    // The `<` is two rows up; the row between it carries real cells, and those
    // are what the marks continue.
    expect(carveToHtml('| a | < |\n| b | c |\n| ^ | ^ |\n')).toContain(
      '<tr><td rowspan="2">b</td><td rowspan="2">c</td></tr>',
    )
  })
})
