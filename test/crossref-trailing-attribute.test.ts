/*
 * A cross-reference does not take a trailing attribute block.
 *
 * `</#h>{i}` dropped the `{i}` entirely - not rendered as an attribute, not
 * rendered as text. The attrs attached to the `heading_ref` node, whose
 * renderer emits none, so they were discarded at render (carve-js#537).
 *
 * ATTR_INERT_PREV already exists for exactly this: node types after which a
 * trailing block stays literal because their renderer emits no attributes. Its
 * own comment says the rule "matches carve-rs / carve-php, which keep the
 * `{...}` literal in these cases" - and both do here, resolved or not.
 *
 * Corpus 161 pins the same shape for the other unresolved reference kind:
 * an unresolved footnote reference plus a trailing attribute stays literal.
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a cross-reference with a trailing attribute block', () => {
  it('keeps the block literal when the reference does not resolve', () => {
    expect(carveToHtml('</#h>{i}\n').trim()).toBe('<p>&lt;/#h&gt;{i}</p>')
  })

  it('keeps the block literal when the reference DOES resolve', () => {
    // carve-rs and carve-php keep it literal either way: a crossref renders as
    // a link whose href is structural, and the block never had anywhere to go.
    const html = carveToHtml('# H\n\n</#H>{.c}\n')
    expect(html).toContain('<a href="#H">H</a>{.c}')
    expect(html).not.toContain('class="c"')
  })

  it('still attaches a trailing block to a node that takes one', () => {
    // The fix must not widen: a span still takes its attributes.
    expect(carveToHtml('[x]{.c}\n')).toContain('<span class="c">x</span>')
  })
})
