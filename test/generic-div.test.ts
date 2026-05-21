import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Generic divs: a bare `:::` or attributes-only `::: {…}` opens a plain
 * `<div>` (grammar `div` production; PART 9 §12). Crucially, a `:::`
 * only opens a div when a matching closing `:::` exists ahead — a lone,
 * unclosed `:::` is literal text (djot + carve-php + the grammar).
 */
describe('generic divs', () => {
  it('wraps a bare ::: block in a plain <div>', () => {
    expect(h(':::\nx\n:::')).toBe('<div>\n  <p>x</p>\n</div>')
  })

  it('parses an attributes-only ::: opener', () => {
    expect(h('::: {.x #y}\nz\n:::')).toBe(
      '<div class="x" id="y">\n  <p>z</p>\n</div>',
    )
  })

  it('does NOT open a div for a stray, unclosed ::: after prose', () => {
    // Regression: a lone `:::` must not swallow the rest of the document.
    // Matches djot + carve-php: it stays paragraph text.
    expect(h('before\n:::\nafter')).toBe('<p>before\n:::\nafter</p>')
  })

  it('keeps a trailing unclosed ::: literal', () => {
    expect(h('text\n:::')).toBe('<p>text\n:::</p>')
  })

  it('does not hang or open a div on a nested stray ::: ', () => {
    expect(h('> before\n> :::\n> after')).toBe(
      '<blockquote><p>before\n:::\nafter</p></blockquote>',
    )
  })

  it('does not interrupt a paragraph even for a closed div without a blank line', () => {
    // djot opens a fenced div only after a blank line; a `:::` reached
    // mid-paragraph is literal text.
    expect(h('before\n:::\nx\n:::')).toBe('<p>before\n:::\nx\n:::</p>')
  })

  it('still renders canonical admonitions as <aside>', () => {
    expect(h('::: note\nz\n:::')).toBe(
      '<aside class="admonition note">\n  <p>z</p>\n</aside>',
    )
  })
})
