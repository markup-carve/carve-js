import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * A paragraph's leading whitespace is always stripped — Carve has no indented
 * code blocks (it follows djot, not CommonMark, here), so indentation never
 * survives into a paragraph. This holds for the first line too, not just
 * continuation lines. Matches carve-php and djot. See markup-carve/carve#65.
 */
describe('paragraph leading whitespace is stripped', () => {
  it('strips a single leading space', () => {
    expect(h(' c')).toBe('<p>c</p>')
  })

  it('strips three leading spaces', () => {
    expect(h('   c')).toBe('<p>c</p>')
  })

  it('strips four leading spaces (no indented code blocks in Carve)', () => {
    expect(h('    c')).toBe('<p>c</p>')
  })

  it('strips the leading space of a fresh paragraph after a blank line', () => {
    expect(h('x\n\n c')).toBe('<p>x</p>\n<p>c</p>')
  })

  it('strips the leading space of a paragraph that follows a closed list', () => {
    // The list closes on the blank line; ` c` is a new top-level paragraph.
    expect(h('- a\n  - b\n\n c')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>c</p>',
    )
  })

  it('still lazily folds an under-indented continuation into the deepest item', () => {
    // No blank line: ` c` is a lazy continuation of b (CommonMark), stripped.
    expect(h('- a\n  - b\n c')).toContain('<li>b\nc</li>')
  })
})
