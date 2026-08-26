import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `+` IS ONE OPERATION IN EVERY CONTAINER (PART 9 §17 L3/L4,
 * markup-carve/carve#1782): ownership of the next flush-left block passes to
 * the container, and the block is then parsed like any other. WHAT KIND of
 * block it is is not a parameter.
 *
 * The block quote's attach boundary tested for a `>` line, so the one kind the
 * marker refused to attach was a quote: the `+` line vanished, `> q` folded
 * into the quoted paragraph above it, and the marker did nothing at all - which
 * the same clause forbids one sentence up ("the marker only ATTACHES").
 *
 * The one-block narrowing is what keeps the paragraph case unchanged, so both
 * halves of the rule are pinned here (carve-js#1532, corpus category 427).
 */
describe('a quote attached to a quote nests', () => {
  it('attaches the quote as a nested block', () => {
    expect(carveToHtml('> a\n+\n> q\n')).toBe(
      '<blockquote>\n  <p>a</p>\n  <blockquote><p>q</p></blockquote>\n</blockquote>',
    )
  })

  it('leaves a quote below an attached PARAGRAPH continuing the outer quote', () => {
    // The control. The narrowing stops the attachment at `para`, so the `> q`
    // line is an ordinary quote line of the same quote and not a second
    // attached block.
    expect(carveToHtml('> a\n+\npara\n> q\n')).toBe(
      '<blockquote>\n  <p>a</p>\n  <p>para</p>\n  <p>q</p>\n</blockquote>',
    )
  })

  it('attaches a list to a quote exactly as before', () => {
    expect(carveToHtml('> a\n+\n- x\n')).toBe(
      '<blockquote>\n  <p>a</p>\n  <ul>\n    <li>x</li>\n  </ul>\n</blockquote>',
    )
  })
})
