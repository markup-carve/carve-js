import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * markup-carve/carve#1970, corpus 444-13: the canonical re-emission of trailing
 * list-item content that sits below a description body's column.
 *
 * When a description's last block CLOSES a paragraph - here a heading - a line
 * written back at the item's content column starts a fresh item block, so the
 * writer needs neither a `+` attached-block lead-in nor a blank line. carve-rs
 * and carve-php emit the 2-space continuation; carve-js used to emit the `+`
 * form. All three parse back to the same tree, so this is a canonical-form
 * ruling and the outlier converges to the majority.
 */
describe('trailing item content after a description', () => {
  const source = '- intro\n\n  :: term\n  :  definition\n      # H\n  tail\n'

  it('re-emits the tail as a 2-space continuation, not a + lead-in', () => {
    expect(carveToCarve(source)).toBe('- intro\n  :: term\n  : definition\n\n    # H\n  tail\n')
  })

  it('preserves the rendering and is idempotent', () => {
    const once = carveToCarve(source)
    expect(carveToHtml(once)).toBe(carveToHtml(source))
    expect(carveToCarve(once)).toBe(once)
  })

  /*
   * The other side of the ruling: when the description's last block LEAVES A
   * PARAGRAPH OPEN, a bare line at the content column would lazily fold into it,
   * so the `+` form is still the portable one and must survive a format cycle.
   */
  it('keeps the + lead-in when the description leaves a paragraph open', () => {
    const withOpenParagraph = '- intro\n  :: term\n  : definition\n+\ntail\n'
    const once = carveToCarve(withOpenParagraph)
    expect(once).toBe(withOpenParagraph)
    expect(carveToHtml(once)).toBe(carveToHtml(withOpenParagraph))
  })
})
