import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

// A paragraph's continuation lines (every line after the first) have their
// leading whitespace stripped, matching djot / CommonMark. carve-js previously
// kept the leading whitespace, so a hard-wrapped or over-indented continuation
// line carried stray spaces into the rendered text. Outputs verified against
// the djot reference (@djot/djot) and carve-php.
describe('paragraph continuation lines are left-trimmed', () => {
  it('strips leading spaces on a top-level continuation line', () => {
    expect(h('a\n   b')).toBe('<p>a\nb</p>')
  })

  it('strips a smaller hard-wrap indent too', () => {
    expect(h('para\n  wrapped')).toBe('<p>para\nwrapped</p>')
  })

  it('strips a leading tab', () => {
    expect(h('x\n\ty')).toBe('<p>x\ny</p>')
  })

  it('leaves an unindented continuation unchanged', () => {
    expect(h('a\nb')).toBe('<p>a\nb</p>')
  })

  it('strips every continuation line, not just the second', () => {
    expect(h('text\n   more\n     lines')).toBe('<p>text\nmore\nlines</p>')
  })

  it('an over-indented lazy continuation in an item keeps no residual indent', () => {
    // After the lead line, an over-indented continuation folds into the item's
    // paragraph with its leading whitespace removed (matches djot + carve-php).
    expect(h('- a\n     word')).toBe('<ul>\n  <li>a\nword</li>\n</ul>')
  })
})
