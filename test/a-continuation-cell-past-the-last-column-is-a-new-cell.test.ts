// markup-carve/carve#4470 (PART 9 §5 T6, CARVE-P12-069), corpus rows 856-a-continuation-cell-past-the-last-column-is-a-new-cell.
import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, lintCarve, parse } from '../src/index.js'

const strip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, node) => (key === 'pos' ? undefined : node)))

const rows = (source: string): unknown => (strip(parse(source).children[0]) as { rows: unknown }).rows

describe('a continuation cell past the last column', () => {
  it.each([
    ['is appended to the row above', '| a | b |\n+ c | d | e |\n',
      '<table>\n  <tbody>\n    <tr><td>a c</td><td>b d</td><td>e</td></tr>\n  </tbody>\n</table>'],
    ['leaves a skipped column empty and takes later joins', '| a |\n+ b | | c |\n+ d | | e |\n',
      '<table>\n  <tbody>\n    <tr><td>a b d</td><td></td><td>c e</td></tr>\n  </tbody>\n</table>'],
    ['appends nothing for an empty slot', '| a |\n+ b | |\n',
      '<table>\n  <tbody>\n    <tr><td>a b</td></tr>\n  </tbody>\n</table>'],
    ['is text, never a span marker', '| a | x |\n| b |\n+ c | ^ |\n',
      '<table>\n  <tbody>\n    <tr><td>a</td><td>x</td></tr>\n    <tr><td>b c</td><td>^</td></tr>\n  </tbody>\n</table>'],
    ['is a header cell when the rest of the row is', '|= a |\n+ b | c |\n| d | e |\n',
      '<table>\n  <thead>\n    <tr><th scope="col">a b</th><th scope="col">c</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>d</td><td>e</td></tr>\n  </tbody>\n</table>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('starts with the cell_wrap of the line that appended it', () => {
    expect(rows('| a |\n+ b | | c |\n')).toEqual([{
      type: 'table_row',
      continuationLines: 1,
      cells: [
        { type: 'table_cell', header: false, children: [{ type: 'text', value: 'a' }, { type: 'cell_wrap', line: 1 }, { type: 'text', value: 'b' }] },
        { type: 'table_cell', header: false, children: [{ type: 'cell_wrap', line: 1 }] },
        { type: 'table_cell', header: false, children: [{ type: 'cell_wrap', line: 1 }, { type: 'text', value: 'c' }] },
      ],
    }])
  })

  it.each([
    '| a | b |\n+ c | d | e |\n',
    '| a |\n+ b | | c |\n+ d | | e |\n',
    '| a | x |\n| b |\n+ c | ^ |\n',
    '|= a |\n+ b | c |\n| d | e |\n',
    '> | a |\n> + b | c |\n',
  ])('is written back on its + line: %j', (source) => {
    expect(carveToCarve(source)).toBe(source)
  })

  it('reports the row on the + line', () => {
    expect(lintCarve('| a | b |\n+ c | d | e |\n').map(({ line, column, rule }) => ({ line, column, rule })))
      .toEqual([{ line: 2, column: 1, rule: 'table-row-cell-count' }])
    expect(lintCarve('| a | b |\n+ c | d |\n')).toEqual([])
  })
})
