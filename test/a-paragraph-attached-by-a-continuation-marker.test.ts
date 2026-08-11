import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * The writer keeps a `+` continuation marker (carve#861).
 *
 * §17 L3 attaches the FOLLOWING block to the item, so `- a` / `+` / `b` is an
 * item holding two blocks. The writer dropped the marker and indented `b`,
 * which re-parses as a LAZY CONTINUATION of the paragraph above it - one
 * block, not two - so `to_html(fmt(x)) != to_html(x)`.
 *
 * A paragraph is the only attached kind this reaches: a fence, quote, heading,
 * table, div or thematic break cannot be folded into an open paragraph, so the
 * dropped marker was harmless for them and the invariant held. The corpus
 * pinned exactly those harmless kinds, which is why nothing caught it - and why
 * all three engines share the defect rather than diverging.
 */
describe('a paragraph attached by a continuation marker', () => {
  const roundTrips = (src: string): boolean => carveToHtml(carveToCarve(src)) === carveToHtml(src)

  it('survives fmt at the top level', () => {
    expect(roundTrips('- a\n+\nb\n\nx\n')).toBe(true)
  })

  it('survives fmt inside a nested item', () => {
    // The marker sits at the ITEM's marker column, which is not column 0 here.
    expect(roundTrips('- o\n  - a\n  +\n  b\n\nx\n')).toBe(true)
  })

  it('is written back as a marker, not as indented text', () => {
    // The bytes, because the assertion above passes for any spelling whose
    // HTML happens to match - and the point is that the marker survives.
    expect(carveToCarve('- a\n+\nb\n\nx\n')).toContain('\n+\n')
  })

  it('is idempotent', () => {
    // PART 11 §1's other half: the written form must be a fixed point.
    const once = carveToCarve('- a\n+\nb\n\nx\n')

    expect(carveToCarve(once)).toBe(once)
  })

  it('keeps an explicit boundary for every attached block kind', () => {
    for (const block of ['```\nb\n```', '> b', '# b', '::: note\nb\n:::', '---']) {
      const src = `- a\n+\n${block}\n\nx\n`
      expect(roundTrips(src), src).toBe(true)
      expect(carveToCarve(src), src).toContain('\n+\n')
    }
  })

  it('leaves an ordinary two-paragraph loose item alone', () => {
    // The boundary: a LOOSE item separates its blocks with a blank line and
    // needs no marker. Emitting one here would change the item's looseness.
    const src = '- a\n\n  b\n\nx\n'

    expect(roundTrips(src)).toBe(true)
    expect(carveToCarve(src)).not.toContain('\n+\n')
  })
})
