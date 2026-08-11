import { describe, it, expect } from 'vitest'
import { carveToCarve } from '../src/index.js'

/**
 * A hoisted definition is written where the tree puts it.
 *
 * §7: "Definitions appear in DOCUMENT ORDER by source position", and this engine
 * publishes them that way since carve#746. PART 11 §6 then binds the writer -
 * "fmt does not reorder ... those are the author's choices and the AST records
 * them".
 *
 * The writer rendered `children` and appended every footnote definition
 * afterwards, because the runtime keeps them in a label-keyed map where their
 * position among the children is not part of what the writer walks. A link
 * definition written INSIDE a footnote body therefore came out before the
 * footnote that contains it (carve-js#750).
 *
 * carve-php writes the tree order; carve-rs has the same defect (carve-rs#682).
 */
describe('the writer keeps the tree order of hoisted definitions', () => {
  it('writes a footnote before a link definition that follows it', () => {
    // corpus 202: the link definition sits on the footnote body's continuation
    // line, so it is hoisted from INSIDE the footnote and lands after it.
    const src = "see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n"
    expect(carveToCarve(src)).toBe('see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n')
  })

  it('writes a link definition before a footnote that follows it', () => {
    // The mirror. A fixed kind order passes one of these two and fails the
    // other, whichever order it picks.
    const src = 'see[^a] and [t][r]\n\n[r]: /u\n\n[^a]: note\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('keeps two footnotes in source order', () => {
    const src = 'see[^b] and[^a]\n\n[^b]: bee\n\n[^a]: ay\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('is idempotent on the interleaved shape', () => {
    const once = carveToCarve("see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n")
    expect(carveToCarve(once)).toBe(once)
  })

  it('still renders the same html', () => {
    // PART 11 §1, asserted so a reordering fix cannot change the document.
    const src = "see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n"
    return import('../src/index.js').then(({ carveToHtml }) => {
      expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    })
  })
})
