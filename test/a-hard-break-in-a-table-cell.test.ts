import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToAst, htmlToCarve, parse, renderCarve } from '../src/index.js'

// A table row is one line and a hard break is a backslash plus a newline, so a
// break inside a cell has no Carve spelling. It flattens to one space; the HTML
// importer reports it and the writer has no channel to (markup-carve/carve#2067).

describe('the HTML importer and a <br> in a table cell', () => {
  it.each([
    ['a break after text', '<table><tr><td>x<br></td><td>c</td></tr></table>', '| x | c |\n'],
    ['a break between words', '<table><tr><td>x<br>y</td><td>c</td></tr></table>', '| x y | c |\n'],
    ['a break in the last cell', '<table><tr><td>a</td><td>x<br></td></tr></table>', '| a | x |\n'],
    ['a break before text', '<table><tr><td><br>y</td></tr></table>', '| y |\n'],
    ['two breaks between words', '<table><tr><td>x<br><br>y</td></tr></table>', '| x y |\n'],
    ['a break with a space before it', '<table><tr><td>x <br>y</td></tr></table>', '| x y |\n'],
    ['a break inside a link', '<table><tr><td><a href="u">a<br>b</a></td></tr></table>', '| [a b](u) |\n'],
    ['a break before a strong', '<table><tr><td>x<br><strong>y</strong></td></tr></table>', '| x *y* |\n'],
    ['a break before a code span', '<table><tr><td>x<br><code>c</code></td></tr></table>', '| x `c` |\n'],
    ['a break before a span opening with a space', '<table><tr><td>x<br><span class="k"> y</span></td></tr></table>', '| x [y]{.k} |\n'],
    ['a break in a header cell', '<table><tr><th>x<br>y</th></tr><tr><td>d</td></tr></table>', '|= x y |\n| d |\n'],
  ])('keeps the table for %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(parse(result.value).children[0]?.type).toBe('table')
    expect(carveToCarve(result.value)).toBe(result.value)
    const reports = result.report.diagnostics.filter((d) => d.code === 'structure-unspellable')
    expect(reports).toHaveLength((html.match(/<br>/g) ?? []).length)
    expect(reports[0]?.path).toMatch(/\/br\[\d+\]$/)
  })

  it('keeps the break in the tree htmlToAst returns', () => {
    const table = htmlToAst('<table><tr><td>x<br>y</td></tr></table>').value.children[0]
    expect(JSON.stringify(table)).toContain('"hard_break"')
  })

  it('leaves a break outside a table alone', () => {
    const result = htmlToCarve('<p>x<br>y</p>')
    expect(result.value).toBe('x\\\ny\n')
    expect(result.report.diagnostics).toEqual([])
  })
})

describe('the writer and a hard break in a table cell', () => {
  it.each([
    ['directly in the cell', '<table><tr><td>x<br>y</td><td>c</td></tr></table>', '| x y | c |\n'],
    ['inside a strong in the cell', '<table><tr><td><strong>x<br>y</strong></td></tr></table>', '| *x y* |\n'],
    ['at the end of the cell', '<table><tr><td>x<br></td><td>c</td></tr></table>', '| x | c |\n'],
    ['after a space', '<table><tr><td>x <br>y</td></tr></table>', '| x y |\n'],
    ['after text that needs one escape', '<table><tr><td>a (b) *c*<br>y</td></tr></table>', '| a (b) \\*c* y |\n'],
  ])('writes one %s as the importer does', (_, html, carve) => {
    const tree = htmlToAst(html).value
    const before = JSON.stringify(tree)
    expect(renderCarve(tree)).toBe(carve)
    expect(renderCarve(tree)).toBe(htmlToCarve(html).value)
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('writes a break outside a table', () => {
    expect(renderCarve(htmlToAst('<p>x<br>y</p>').value)).toBe('x\\\ny\n')
  })
})
