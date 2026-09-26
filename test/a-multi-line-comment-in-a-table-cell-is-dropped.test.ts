import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

// markup-carve/carve#2372: a pipe-table row is one line, so a comment holding
// a line break has no spelling in a cell.
describe('an HTML comment in a table cell', () => {
  it.each([
    ['inline', '<table><tr><td>a <!-- x\ny --> b</td></tr></table>', '| a  b |\n', '/table[1]/tr[1]/td[1]/comment()[2]'],
    ['after a block', '<table><tr><td><p>a</p>\n\n<!-- note\n|x\n --></td></tr></table>', '| a |\n', '/table[1]/tr[1]/td[1]/comment()[3]'],
  ])('is dropped with a row when it holds a line break: %s', (_, html, carve, path) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(carveToHtml(result.value)).toContain('<table>')
    expect(result.report.diagnostics.filter((d) => d.code === 'element-dropped').map((d) => [d.severity, d.path])).toEqual([['warning', path]])
  })

  it('is kept when it is one line', () => {
    const result = htmlToCarve('<table><tr><td>a <!-- one line --> b</td></tr></table>')
    expect(result.value).toBe('| a {%  one line  %} b |\n')
    expect(result.report.diagnostics).toEqual([])
  })

  it('outside a cell keeps its line break', () => {
    expect(htmlToCarve('<p>a <!-- x\ny --> b</p>').value).toBe('a {%  x\ny  %} b\n')
  })
})
