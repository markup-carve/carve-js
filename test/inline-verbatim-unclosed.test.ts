import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

// An inline verbatim span opens on a MAXIMAL run of backticks and closes only
// on a run of EXACTLY the same length. A run with no equal-length closer still
// opens a verbatim span that extends to the end of the block. Expected outputs
// are verified byte-for-byte against the djot reference (@djot/djot) and match
// carve-php. Previously carve-js left an unclosed run as literal text and could
// shrink the opener to latch onto a shorter closer — both divergences are fixed.
describe('inline verbatim: unclosed run runs to end of block', () => {
  it('an unclosed triple-fence inside a paragraph opens a span', () => {
    expect(h('text\n```\ncode')).toBe('<p>text\n<code>\ncode</code></p>')
  })

  it('a lone unclosed backtick opens a span', () => {
    expect(h('a `x')).toBe('<p>a <code>x</code></p>')
  })

  it('an unclosed double run opens a span', () => {
    expect(h('a ``x')).toBe('<p>a <code>x</code></p>')
  })

  it('a shorter inner run does not close a longer opener', () => {
    expect(h('``x` y')).toBe('<p><code>x` y</code></p>')
  })

  it('the opener is maximal: a single tick later does not close a double', () => {
    expect(h('x `` y ` z')).toBe('<p>x <code> y ` z</code></p>')
  })

  it('strips block trailing whitespace from an unclosed span', () => {
    expect(h('text\n```\ncode ')).toBe('<p>text\n<code>\ncode</code></p>')
  })

  it('keeps a closed equal-length span unchanged', () => {
    expect(h('a ``code`` b')).toBe('<p>a <code>code</code> b</p>')
  })

  it('an unclosed run spans a soft line break', () => {
    expect(h('a `x\nmore')).toBe('<p>a <code>x\nmore</code></p>')
  })

  // An unclosed run is opaque to emphasis and bracket matching: a delimiter or
  // link tail after it is verbatim content, so the surrounding construct never
  // closes. Verified against the djot reference + carve-php.
  it('is opaque to an emphasis closer', () => {
    expect(h('*a ` b*')).toBe('<p>*a <code> b*</code></p>')
  })

  it('is opaque to a link bracket and tail', () => {
    expect(h('[a `b](u)')).toBe('<p>[a <code>b](u)</code></p>')
  })

  it('a closed span still hides a bracket from link matching', () => {
    expect(h('[a `]` b](u)')).toBe('<p><a href="u">a <code>]</code> b</a></p>')
  })
})
