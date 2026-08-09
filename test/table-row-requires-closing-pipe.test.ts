import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('a table row needs a closing pipe', () => {
  it('a stray leading `|` with no closing `|` is paragraph text', () => {
    expect(html('| a')).toBe('<p>| a</p>')
    expect(html('| a | b')).toBe('<p>| a | b</p>')
  })

  it('a single empty cell is paragraph text, but two empty cells are a table', () => {
    // `|` / `||` (zero or one empty cell) stay paragraphs; `|||` (two empty
    // cells) is a valid all-empty body row, matching carve-php / carve-rs.
    expect(html('|')).toBe('<p>|</p>')
    expect(html('||')).toBe('<p>||</p>')
    expect(html('|||')).toBe(
      '<table>\n  <tbody>\n    <tr><td></td><td></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a complete row (opens and closes with `|`) is a table', () => {
    expect(html('| a |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a whitespace-only single cell is literal text', () => {
    expect(html('| |')).toBe('<p>| |</p>')
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
