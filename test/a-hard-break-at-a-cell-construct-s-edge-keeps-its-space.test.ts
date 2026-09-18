import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, parse, renderCarve } from '../src/index.js'

// A break that is a direct child at the cell's edge writes no space, because it
// separates nothing. One at the edge of a construct INSIDE the cell keeps its
// space: the construct's closer stands between the break and the cell's trim
// (ruling markup-carve/carve#2067, ported from markup-carve/carve-php#2172).

const rows: Array<[name: string, html: string, carve: string, readBack: string]> = [
  ['a strikeout ending in a break', '<table><tr><td><s>x<br></s></td></tr></table>', '| {~x ~} |\n', '<s>x </s>'],
  ['an insert holding only a break', '<table><tr><td><ins><br></ins></td></tr></table>', '| {+ +} |\n', '<ins> </ins>'],
  ['a kbd ending in a break', '<table><tr><td><kbd>x<br></kbd></td></tr></table>', '| [x ]{kbd} |\n', '<kbd>x </kbd>'],
  ['an insert ending in a break', '<table><tr><td><ins>x<br></ins></td></tr></table>', '| {+x +} |\n', '<ins>x </ins>'],
  ['an emphasis ending in a break', '<table><tr><td><em>x<br></em></td></tr></table>', '| {/x /} |\n', '<em>x </em>'],
  ['a kbd holding only a break', '<table><tr><td><kbd><br></kbd></td></tr></table>', '| [ ]{kbd} |\n', '<kbd> </kbd>'],
  ['an underline opening on a break', '<table><tr><td><u><br>x</u></td></tr></table>', '| {_ x_} |\n', '<u> x</u>'],
  ['a construct edge in a header cell', '<table><tr><th><ins><br></ins></th></tr><tr><td>d</td></tr></table>', '|= {+ +} |\n| d |\n', '<ins> </ins>'],
]

describe('the writer and a hard break at the edge of a construct in a table cell', () => {
  it.each(rows)('writes %s with its space', (_, html, carve) => {
    expect(htmlToCarve(html).value).toBe(carve)
    expect(renderCarve(htmlToAst(html).value)).toBe(carve)
  })

  // The teeth: both shapes the ruling names wrote well-formed Carve that says
  // something else, so bytes alone cannot tell a repair from the defect.
  it.each(rows)('reads %s back as the construct it was written for', (_, html, carve, readBack) => {
    const written = htmlToCarve(html).value
    expect(parse(written).children[0]?.type).toBe('table')
    expect(carveToHtml(written)).toContain(readBack)
    expect(carveToCarve(written)).toBe(carve)
  })

  it('an empty brace pair is literal text, which is what the dropped space left behind', () => {
    expect(carveToHtml('| {++} |\n')).toContain('{++}')
    expect(carveToHtml('| {++} |\n')).not.toContain('<ins>')
  })

  it('still drops the space for a break that is a direct child at the cell edge', () => {
    expect(htmlToCarve('<table><tr><td>x<br></td><td>c</td></tr></table>').value).toBe('| x | c |\n')
    expect(htmlToCarve('<table><tr><td><br></td><td>c</td></tr></table>').value).toBe('| | c |\n')
    expect(htmlToCarve('<table><tr><td>a</td><td><br>x<br></td></tr></table>').value).toBe('| a | x |\n')
  })
})
