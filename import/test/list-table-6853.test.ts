import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'
import { render } from '../../src/index.ts'
import { listTableExtension, listTableRenderer } from '../../extensions/blocks/list-table.ts'

const listTable = (html: string): { source: string, codes: string[] } => {
  const result = importDocument(html, { from: 'html', listTable: true })
  return { source: result.source, codes: result.diagnostics.map(diagnostic => diagnostic.code) }
}
const html = (source: string): string =>
  render(source, { extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer } }).trim()

describe('C2-M-112: a list-table row with no cell gives no item and no count (carve#6853)', () => {
  it('footer-rows counts only the foot rows that give an item', () => {
    const { source, codes } = listTable('<table><tbody><tr><td><ul><li>a</li></ul></td></tr><tr><td>b</td></tr></tbody>'
      + '<tfoot><tr></tr><tr><td>f</td></tr></tfoot></table>')
    expect(source).toBe('{footer-rows=1}\n::: list-table\n- - - a\n- - b\n- - f\n:::\n')
    expect(codes).toEqual(['import-structure-repaired'])
    expect(html(source)).toContain('<tfoot>\n    <tr><td>f</td></tr>\n  </tfoot>')
  })
  it('header-rows counts only the head rows that give an item', () => {
    const { source, codes } = listTable('<table><thead><tr><th>h</th></tr><tr></tr></thead>'
      + '<tbody><tr><td><ul><li>a</li></ul></td></tr><tr><td>b</td></tr></tbody></table>')
    expect(source).toBe('{header-rows=1}\n::: list-table\n- - h\n- - - a\n- - b\n:::\n')
    expect(codes).toEqual(['import-structure-repaired'])
  })
  it('an empty row keeps the header columns of the other rows', () => {
    const { source, codes } = listTable('<table><tr><th>R</th><td><ul><li>a</li></ul></td></tr><tr></tr>'
      + '<tr><th>S</th><td>b</td></tr></table>')
    expect(source).toBe('{header-cols=1}\n::: list-table\n- - R\n  - - a\n- - S\n  - b\n:::\n')
    expect(codes).toEqual(['import-structure-repaired'])
  })
  it('a row a row span covers entirely keeps its ^ item and its count', () => {
    const { source, codes } = listTable('<table><tbody><tr><td rowspan="2"><ul><li>a</li></ul></td></tr><tr></tr></tbody>'
      + '<tfoot><tr><td>f</td></tr></tfoot></table>')
    expect(source).toBe('{footer-rows=1}\n::: list-table\n- - - a\n- - ^\n- - f\n:::\n')
    expect(codes).toEqual([])
  })
})
