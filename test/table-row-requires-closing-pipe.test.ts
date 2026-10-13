import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('a table row needs a closing pipe', () => {
  it('a stray leading `|` with no closing `|` is paragraph text', () => {
    expect(html('| a')).toBe('<p>| a</p>')
    expect(html('| a | b')).toBe('<p>| a | b</p>')
  })

  it('a lone pipe is paragraph text, but every delimited slot is a cell', () => {
    // CARVE-P9-082: slots are counted, not weighed. `||` is one empty cell and
    // `|||` two; only `|` has no slot.
    expect(html('|')).toBe('<p>|</p>')
    expect(html('||')).toBe('<table>\n  <tbody>\n    <tr><td></td></tr>\n  </tbody>\n</table>')
    expect(html('|||')).toBe('<table>\n  <tbody>\n    <tr><td></td><td></td></tr>\n  </tbody>\n</table>')
  })

  it('a complete row (opens and closes with `|`) is a table', () => {
    expect(html('| a |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a blank row without both pipes stays prose', () => {
    expect(html('|  ')).toBe('<p>|</p>')
    expect(html('|| a')).toBe('<p>|| a</p>')
    expect(html('| | a')).toBe('<p>| | a</p>')
    expect(html('a | |')).toBe('<p>a | |</p>')
    expect(html('para\n|')).toBe('<p>para\n|</p>')
  })

  it('a whitespace-only single cell is one empty cell', () => {
    expect(html('| |')).toBe('<table>\n  <tbody>\n    <tr><td></td></tr>\n  </tbody>\n</table>')
  })

  it('an incomplete row does not interrupt a paragraph or heading', () => {
    expect(html('para\n| a')).toBe('<p>para\n| a</p>')
    // The incomplete row opens no table; after a heading it is a paragraph,
    // since a heading ends at its newline and folds nothing in.
    expect(html('# H\n| a')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>| a</p>\n</section>',
    )
  })
})
