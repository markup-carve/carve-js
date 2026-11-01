import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// Rulings N-R1, N-R2, N-R4, N-R5 and N-R7 of the 2026-10-31 confirmation round
// (markup-carve/carve#4548, #4549, #4551, #4552, #4554). Each expected string is
// the spec model's output at carve main 26baf86b.
const html = (source: string): string => carveToHtml(source).trim()

describe('a blanked style still takes the alignment (carve#4548)', () => {
  it.each([
    ['a paragraph', '{style="url(x)" align=right}\np\n', '<p style="text-align: right;">p</p>'],
    ['a scheme-blanked style', '{style="javascript:x" align=right}\np\n', '<p style="text-align: right;">p</p>'],
    ['a div', '{style="url(x)" align=right}\n:::\nd\n:::\n', '<div style="text-align: right;">\n  <p>d</p>\n</div>'],
    ['a table cell', '|>{style="url(x)"} a |\n', '<table>\n  <tbody>\n    <tr><td style="text-align: right;">a</td></tr>\n  </tbody>\n</table>'],
    ['a safe style keeps its value', '{style="color: red" align=center}\np\n', '<p style="color: red; text-align: center;">p</p>'],
    ['an unknown align stays a key', '{style="url(x)" align=bogus}\np\n', '<p style="" align="bogus">p</p>'],
  ])('%s', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe("a cell's escaped pipe reaches a destination as a pipe (carve#4549)", () => {
  it.each([
    ['a link', '| [x](/a\\|b) |\n', '<td><a href="/a|b">x</a></td>'],
    ['an image', '| ![i](/j\\|k) |\n', '<td><img src="/j|k" alt="i"></td>'],
    ['a link in emphasis', '| *[e](/f\\|g)* |\n', '<td><strong><a href="/f|g">e</a></strong></td>'],
    ['a code span keeps its backslash', '| `a\\|b` |\n', '<td><code>a\\|b</code></td>'],
  ])('%s', (_name, source, cell) => {
    expect(html(source)).toContain(cell)
    expect(carveToCarve(source)).toBe(source)
  })

  it('leaves a destination outside a table alone', () => {
    expect(html('[x](/a\\|b)\n')).toBe('<p><a href="/a\\|b">x</a></p>')
  })

  it('leaves a reference definition outside the cell alone', () => {
    expect(html('| [r][] |\n\n[r]: /p\\|q\n')).toContain('<td><a href="/p\\|q">r</a></td>')
  })
})

describe('a literal bracket run is a typography region (carve#4551)', () => {
  it.each([
    ['a run at the region start', 'a [--x] y and a [---x] y\n', '<p>a [--x] y and a [---x] y</p>'],
    ['a spaced parenthesis keeps a flag literal (carve#4813)', 'a (--x) y\n', '<p>a (--x) y</p>'],
    ['a run at the region end', '[x--] y\n', '<p>[x–] y</p>'],
    ['an unbalanced bracket', 'a [--x y\n', '<p>a [–x y</p>'],
    ['a nested run', '[a [--b] --c]\n', '<p>[a [--b] --c]</p>'],
    ['a run that fills the region', '[--] y\n', '<p>[–] y</p>'],
  ])('%s', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('a comment at the start of content counts as nothing for quotes (carve#4552)', () => {
  it.each([
    ['a single quote', "{%%}'word\n", '<p>‘word</p>'],
    ['a double quote pair', '{%%}"q"\n', '<p>“q”</p>'],
    ['two comments with text', "{% a %}{%b%}'word x\n", '<p>‘word x</p>'],
    ['a comment after a word', "x {%%}'word\n", '<p>x ’word</p>'],
  ])('%s', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('a cloned heading drops its ids (carve#4554)', () => {
  it('drops an inline id from the link text', () => {
    expect(html('# *A*{#z}\n\n</#A>\n')).toContain('<p><a href="#A"><strong>A</strong></a></p>')
  })

  it('drops every id at every depth and keeps other attributes', () => {
    expect(html('# x [y]{#q .c title=t} `c`{#k}\n\n</#x-y-c>\n'))
      .toContain('<p><a href="#x-y-c">x <span class="c" title="t">y</span> <code>c</code></a></p>')
  })

  it('drops an id key in any case', () => {
    expect(html('# *C*{ID=v data-x=1}\n\n</#C>\n')).toContain('<p><a href="#C"><strong data-x="1">C</strong></a></p>')
  })
})
