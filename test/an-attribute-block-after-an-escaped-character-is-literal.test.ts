import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * `escaped_char = '\', ascii_punctuation` carries no `[attributes]` tail, and
 * neither does a text run, so a block after an escaped character matches no
 * production and is literal text.
 *
 * It was attaching to `escaped_text`, whose renderer emits no attributes, so
 * the braces were consumed and the source characters vanished
 * (markup-carve/carve-js#1766).
 */
describe('an attribute block after an escaped character is literal', () => {
  const html = (src: string) => carveToHtml(src).trim()

  it('keeps the block after an escaped asterisk', () => {
    expect(html('x\\*{a}')).toBe('<p>x*{a}</p>')
  })

  it('keeps the block after an escaped backtick', () => {
    expect(html('\\`{a}')).toBe('<p>`{a}</p>')
  })

  it('keeps the block after an escaped bang', () => {
    expect(html('\\!{a}')).toBe('<p>!{a}</p>')
  })

  it('keeps the block after an escaped apostrophe', () => {
    expect(html("\\'{a}")).toBe("<p>'{a}</p>")
  })

  it('keeps the block after an escaped period', () => {
    expect(html('x\\.{a}')).toBe('<p>x.{a}</p>')
  })

  it('keeps the block after an escaped backslash', () => {
    expect(html('\\\\{a}')).toBe('<p>\\{a}</p>')
  })

  it('reads the unescaped counterpart the same way', () => {
    // The unescaped form never diverged. It is the pair that says the escape
    // is what changed the answer, rather than the block itself.
    expect(html('x*{a}')).toBe('<p>x*{a}</p>')
  })

  it('still attaches a block to a carrier that takes one', () => {
    expect(html('*x*{#i}')).toBe('<p><strong id="i">x</strong></p>')
  })

  it('still attaches a block to a code span', () => {
    expect(html('`x`{#i}')).toBe('<p><code id="i">x</code></p>')
  })
})
