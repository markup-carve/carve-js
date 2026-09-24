import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('table `+` multi-line cell continuation', () => {
  it('appends continuation cells to the previous row', () => {
    const src = [
      '|= Feature |= Description        |',
      '| Complex  | A long description |',
      '+          | that continues     |',
      '+          | across lines.      |',
      '| Simple   | Single line.       |',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <thead>',
        '    <tr><th scope="col">Feature</th><th scope="col">Description</th></tr>',
        '  </thead>',
        '  <tbody>',
        '    <tr><td>Complex</td><td>A long description that continues across lines.</td></tr>',
        '    <tr><td>Simple</td><td>Single line.</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('blank continuation cells contribute nothing', () => {
    const src = ['| a | b |', '+   | c |'].join('\n')
    expect(h(src)).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td><td>b c</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('keeps inline markup in a continuation cell', () => {
    const src = ['| x | a |', '+   | *b* |'].join('\n')
    expect(h(src)).toContain('<td>a <strong>b</strong></td>')
  })

  it('treats a multi-line cell as one logical cell (inline spans the break)', () => {
    const src = ['| a | *bold |', '+   | text* |'].join('\n')
    expect(h(src)).toContain('<td><strong>bold text</strong></td>')
  })

  it('handles the spec Combined: Rowspan + Multi-line example', () => {
    const src = [
      '|= Category       |= Item   |',
      '| Fresh Fruits    | Apple   |',
      '+ from local      |         |',
      '+ farms           |         |',
      '| ^               | Banana  |',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <thead>',
        '    <tr><th scope="col">Category</th><th scope="col">Item</th></tr>',
        '  </thead>',
        '  <tbody>',
        '    <tr><td rowspan="2">Fresh Fruits from local farms</td><td>Apple</td></tr>',
        '    <tr><td>Banana</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('keeps a header rowspan and its continuation in one tbody', () => {
    expect(h('|= A |\n| ^ |')).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><th scope="col" rowspan="2">A</th></tr>',
        '    <tr></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('keeps an explicit head rowspan in one tbody', () => {
    expect(h('{header-rows=1}\n| H | G |\n| ^ | b |')).toBe(
      '<table>\n  <tbody>\n    <tr><th scope="col" rowspan="2">H</th><th scope="col">G</th></tr>\n    <tr><td>b</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('keeps a footer rowspan in one tbody', () => {
    expect(h('{footer-rows=1}\n| a | b |\n| ^ | c |')).toBe(
      '<table>\n  <tbody>\n    <tr><td rowspan="2">a</td><td>b</td></tr>\n    <tr><td>c</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('keeps an uncovered caret below a colspan as an empty cell', () => {
    expect(h('| A | < | X |\n| B | ^ | Y |')).toBe(
      '<table>\n  <tbody>\n    <tr><td colspan="2">A</td><td>X</td></tr>\n    <tr><td>B</td><td></td><td>Y</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('absorbs carets under a visible row and colspan', () => {
    expect(h('{header-rows=1}\n| A | < | C |\n| ^ | ^ | Y |\n| ^ | ^ | Z |')).toBe(
      '<table>\n  <tbody>\n    <tr><th scope="col" rowspan="3" colspan="2">A</th><th scope="col">C</th></tr>\n    <tr><td>Y</td></tr>\n    <tr><td>Z</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a plain + line is not a table continuation (and `+` is not a bullet)', () => {
    expect(h('+ one\n+ two')).toBe('<p>+ one\n+ two</p>')
  })

  it('a table after prose interrupts without a blank line (§10)', () => {
    expect(h('Text\n| a |\n+ b |')).toBe(
      '<p>Text</p>\n<table>\n  <tbody>\n    <tr><td>a b</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a + line with no preceding table row is not a continuation', () => {
    // No table opened, and `+` is not a bullet, so it is paragraph text.
    expect(h('+ just a list')).toBe('<p>+ just a list</p>')
  })

  it('appends content to the first column', () => {
    // `==>` rather than `=>` since markup-carve/carve#1442: the point of the
    // case is that arrow TEXT follows the continuation marker, and `=>` is no
    // longer an arrow.
    const src = ['|= H |', '| v |', '+ ==> x |'].join('\n')
    expect(h(src)).toContain('<td>v ⇒ x</td>') // arrow text, not a marker
  })

  it('accepts a continuation that adds content to column 1', () => {
    const src = ['| a | b |', '+ more | text |'].join('\n')
    expect(h(src)).toContain('<td>a more</td>')
    expect(h(src)).toContain('<td>b text</td>')
  })

  it('does not continue a GFM header-only table before a body row exists', () => {
    expect(h('| a | b |\n| - | - |\n+ cont |')).toBe(
      [
        '<table>',
        '  <thead>',
        '    <tr><th scope="col">a</th><th scope="col">b</th></tr>',
        '  </thead>',
        '</table>',
        '<p>+ cont |</p>',
      ].join('\n'),
    )
  })
})
