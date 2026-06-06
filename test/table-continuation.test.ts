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
        '  <thead><tr><th>Feature</th><th>Description</th></tr></thead>',
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
        '  <thead><tr><th>Category</th><th>Item</th></tr></thead>',
        '  <tbody>',
        '    <tr><td rowspan="2">Fresh Fruits from local farms</td><td>Apple</td></tr>',
        '    <tr><td>Banana</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('does not treat a plain + list as table continuation', () => {
    expect(h('+ one\n+ two')).toBe(
      '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>',
    )
  })

  it('a table after prose interrupts without a blank line (§10)', () => {
    expect(h('Text\n| a |\n+ b |')).toBe(
      '<p>Text</p>\n<table>\n  <tbody>\n    <tr><td>a b</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a + line with no preceding table row is not a continuation', () => {
    // No table opened: parsed as an unordered list, not consumed here.
    expect(h('+ just a list')).toBe('<ul>\n  <li>just a list</li>\n</ul>')
  })

  it('appends content to the first column', () => {
    const src = ['|= H |', '| v |', '+ => x |'].join('\n')
    expect(h(src)).toContain('<td>v ⇒ x</td>') // arrow text, not a marker
  })

  it('accepts a continuation that adds content to column 1', () => {
    const src = ['| a | b |', '+ more | text |'].join('\n')
    expect(h(src)).toContain('<td>a more</td>')
    expect(h(src)).toContain('<td>b text</td>')
  })
})
