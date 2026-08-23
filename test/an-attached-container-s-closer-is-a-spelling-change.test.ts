import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml } from '../src/index.js'

/**
 * carve-js#1376, ruled TIGHT: writing an attached container's missing closer is
 * a spelling change, so the list's tightness must not move across it.
 *
 * #1372 answered the shape markup-carve/carve#1602 was measured on - the
 * container that IS the item's first block, which converges on LOOSE. This is
 * the other configuration of the same production, and it converges the other
 * way for the same reason: on the reading the engine already gives the OTHER
 * spelling. There the source's; here the closed spelling's, which is tight and
 * is what corpus
 * `279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-10`
 * pins.
 *
 * THIS ONE BROKE BOTH FORMS OF §1, unlike #1602's. The lead paragraph rendered
 * `<p>x</p>` on one side and `x` on the other, so `to_html(fmt(x)) ==
 * to_html(x)` failed too - and `test/render-carve.test.ts` has swept the corpus
 * with that assertion all along, green only because no corpus document holds
 * this shape. A corpus document is owed and is named in the PR; the spec repo is
 * frozen for the release, so it cannot land yet.
 */
describe("an attached container's closer is a spelling change", () => {
  const unclosed = '- x\n  :::\n  a\n\n  b\n'
  const closed = '- x\n  :::\n  a\n\n  b\n  :::\n'

  const tightness = (src: string): boolean => {
    const first = carveToAstJson(src).children[0] as { type: string; tight?: boolean }
    expect(first.type).toBe('list')
    return first.tight === true
  }

  it('reads both spellings tight', () => {
    expect(tightness(unclosed)).toBe(true)
    expect(tightness(closed)).toBe(true)
  })

  it('renders both spellings identically, which is the half #1602 never broke', () => {
    // The lead paragraph is what moved: a loose item wraps it in `<p>`, a tight
    // one does not, and nothing about this shape puts the difference out of
    // reach the way a container's interior does.
    expect(carveToHtml(unclosed)).toBe(carveToHtml(closed))
    expect(carveToHtml(unclosed)).toBe(
      '<ul>\n  <li>x\n    <div>\n      <p>a</p>\n      <p>b</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('supplies the closer and NOTHING ELSE', () => {
    // THE BLANK LINE ANSWERS ITSELF, and this is the assertion that records it.
    //
    // The writer used to do two things to this document: supply the closer AND
    // insert a blank line after `x`. That looked like a second spelling change
    // needing its own ruling - under a source-based reading of looseness,
    // inserting a blank line is not innocent.
    //
    // It was never an independent decision. The writer separates an attached
    // block from a LOOSE item's lead with a blank line, so the insertion was a
    // consequence of the wrong tightness reading rather than a choice beside
    // it. With the item read tight there is nothing to separate, the blank is
    // not written, and `fmt` does here exactly what it does on #1602's shape:
    // supplies the closer, changes nothing else.
    expect(carveToCarve(unclosed)).toBe(closed)
    expect(carveToCarve(closed)).toBe(closed)
  })

  it('keeps the LEAD container loose, both spellings', () => {
    // #1372's ruling, unmoved. The two configurations converge on opposite
    // answers, and each converges on what its own other spelling already said -
    // so a fix that made all four agree on one value would be the spec change
    // both rulings declined.
    expect(tightness('- ::: d\n  b\n\n  tail\n')).toBe(false)
    expect(tightness('- ::: d\n  b\n\n  tail\n  :::\n')).toBe(false)
  })

  it('keeps a verbatim fence opaque, closed or not', () => {
    // The closer gate stays for the two verbatim kinds, where an opener with no
    // closer is inline verbatim inside a paragraph and opens no block at all.
    // Only the `:::` container still opens one without its closer, which is what
    // corpus family 362 pins and what made this shape's reading wrong.
    expect(tightness('- x\n  ```\n  a\n\n  b\n  ```\n')).toBe(true)
    expect(tightness('- ```\n  b\n\n  tail\n  ```\n')).toBe(true)
    expect(tightness('- %%%\n  b\n\n  tail\n  %%%\n')).toBe(true)
  })

  it('agrees with carve-php on every attached configuration', () => {
    // Measured on carve-php aae2f24: both attached shapes tight, both lead
    // shapes loose. This brings the two engines into agreement on all four
    // rather than trading one divergence for another.
    for (const src of [unclosed, closed]) expect(tightness(src)).toBe(true)
    for (const src of ['- ::: d\n  b\n\n  tail\n', '- ::: d\n  b\n\n  tail\n  :::\n']) {
      expect(tightness(src)).toBe(false)
    }
  })
})
