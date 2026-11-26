import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'
import { parse, render, treesEqual } from '../../src/index.ts'
import { listTableExtension, listTableRenderer } from '../../extensions/blocks/list-table.ts'

const listTable = (html: string): { source: string, codes: string[] } => {
  const result = importDocument(html, { from: 'html', listTable: true })
  const back = parse(result.source, { positions: false })
  const shaped = (children: unknown) => ({ type: 'document', astVersion: '2.0', children }) as never
  expect(treesEqual(shaped(back.children), shaped(result.document.children))).toBe(true)
  return { source: result.source, codes: result.diagnostics.map(diagnostic => diagnostic.code) }
}
const html = (source: string): string =>
  render(source, { extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer } }).trim()
const rows = (source: string): string[] => html(source).split('\n').filter(line => line.includes('<tr'))
  .map(line => line.trim())

describe('C2-M-112 and C2-X-076: a list-table cell of the text < or ^ (carve#6795)', () => {
  it('spells a cell of the text < as a literal-text span and renders it as a cell', () => {
    const { source, codes } = listTable('<table><tr><td>a</td><td>&lt;</td></tr><tr><td><ul><li>b</li></ul></td><td>w</td></tr></table>')
    expect(source).toBe('::: list-table\n- - a\n  - !`<`\n- - - b\n  - w\n:::\n')
    expect(codes).toEqual([])
    expect(rows(source)[0]).toBe('<tr><td>a</td><td>&lt;</td></tr>')
  })
  it('spells the cell as a literal also where it would join nothing', () => {
    expect(listTable('<table><tr><td>&lt;</td><td><ul><li>b</li></ul></td></tr></table>').source)
      .toBe('::: list-table\n- - !`<`\n  - - b\n:::\n')
    expect(listTable('<table><tr><td>^</td><td><ul><li>b</li></ul></td></tr></table>').source)
      .toBe('::: list-table\n- - !`^`\n  - - b\n:::\n')
  })
  it('keeps the span marks of covered slots as text marks', () => {
    expect(listTable('<table><tr><td colspan="2">a</td></tr><tr><td>^</td><td><ul><li>b</li></ul></td></tr></table>').source)
      .toBe('::: list-table\n- - a\n  - <\n- - !`^`\n  - - b\n:::\n')
  })
  it('a literal-text span is never a mark', () => {
    expect(rows('::: list-table\n- - a\n  - b\n- - !`^`\n  - !`<`\n:::\n')[1]).toBe('<tr><td>^</td><td>&lt;</td></tr>')
  })
  it('a < whose left cell a row span covers from above joins nothing', () => {
    expect(rows('::: list-table\n- - x\n  - y\n- - ^\n  - <\n:::\n'))
      .toEqual(['<tr><td rowspan="2">x</td><td>y</td></tr>', '<tr><td>&lt;</td></tr>'])
  })
  it('a < right of a refused < joins that cell', () => {
    expect(rows('::: list-table\n- - x\n  - y\n  - z\n- - ^\n  - <\n  - <\n:::\n')[1]).toBe('<tr><td colspan="2">&lt;</td></tr>')
  })
})
