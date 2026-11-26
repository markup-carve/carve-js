import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'
import { parse, treesEqual } from '../../src/index.ts'

const listTable = (html: string): { source: string, codes: string[] } => {
  const result = importDocument(html, { from: 'html', listTable: true })
  const back = parse(result.source, { positions: false })
  const shaped = (children: unknown) => ({ type: 'document', astVersion: '2.0', children }) as never
  expect(treesEqual(shaped(back.children), shaped(result.document.children))).toBe(true)
  return { source: result.source, codes: result.diagnostics.map(diagnostic => diagnostic.code) }
}

describe('C2-M-112: the listTable import option (carve#6771)', () => {
  it('C2-B-062: a row of one cell of two blocks is a tight list, as a list with one item reads', () => {
    expect(listTable('<table><tr><td><p>x</p><p>y</p></td></tr></table>').source).toBe('::: list-table\n- - x\n\n    y\n:::\n')
  })
  it('a nested table whose cells hold blocks is a list table of its own', () => {
    expect(listTable('<table><tr><td><table><tr><td><ul><li>n</li></ul></td></tr></table></td><td>a</td></tr></table>').source)
      .toBe(':::: list-table\n- - ::: list-table\n    - - - n\n    :::\n  - a\n::::\n')
  })
  it('drops and reports the boundary between two bodies, a column width and a group attribute', () => {
    const { source, codes } = listTable('<table><colgroup><col style="width: 50%"></colgroup>'
      + '<tbody class="b"><tr><td><ul><li>a</li></ul></td></tr></tbody><tbody><tr><td>b</td></tr></tbody></table>')
    expect(source).toBe('::: list-table\n- - - a\n- - b\n:::\n')
    expect(codes.sort()).toEqual(['import-attribute-dropped', 'import-attribute-dropped', 'import-structure-repaired'])
  })
  it('drops and reports a caption that is not one paragraph', () => {
    const { source, codes } = listTable('<table><caption><p>a</p><p>b</p></caption><tr><td><ul><li>a</li></ul></td></tr></table>')
    expect(source).toBe('::: list-table\n- - - a\n:::\n')
    expect(codes).toEqual(['import-element-dropped'])
  })
  it('counts a footer row with a header cell outside the header columns as a header item', () => {
    expect(listTable('<table><tbody><tr><td><ul><li>a</li></ul></td></tr></tbody><tfoot><tr><th>f</th></tr></tfoot></table>').source)
      .toBe('{footer-rows=1}\n::: list-table\n- - - a\n- -{header} f\n:::\n')
  })
  it('a covered slot counts as its header cell for header-cols', () => {
    expect(listTable('<table><tr><th rowspan="2">h</th><td><ul><li>a</li></ul></td></tr><tr><td>b</td></tr></table>').source)
      .toBe('{header-cols=1}\n::: list-table\n- - h\n  - - a\n- - ^\n  - b\n:::\n')
  })
  it('a table whose cells hold one paragraph at most stays a pipe table', () => {
    const result = importDocument('<table><tr><td><p>x</p></td><td>y</td></tr></table>', { from: 'html', listTable: true })
    expect(result.document.children[0]?.type).toBe('table')
  })
  it('is an option of the HTML import only', () => {
    expect(() => importDocument('a', { from: 'markdown', listTable: true })).toThrow(/listTable/)
    expect(() => importDocument('a', { from: 'html', listTable: 17 as never })).toThrow(/listTable: not a boolean/)
  })
})
