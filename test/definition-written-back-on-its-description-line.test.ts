/*
 * A definition collected from a definition list's description is written back
 * ON THAT DESCRIPTION LINE (spec markup-carve/carve#805).
 *
 * Collecting it empties the `dd` (carve#801), and an empty description has no
 * source spelling: the writer emitted a bare `:` line, which re-parses as a
 * continuation of the term. So `to_html(fmt(x)) == to_html(x)` - PART 11 §1 -
 * failed on the two documents that rule added, and the corpus bump has been
 * blocked on it in all three engines.
 *
 * NOTHING NEW WAS NEEDED. The entry records `definitionLines`, the definition
 * node keeps the `pos` it was written at (PART 12 §4), and the two name the SAME
 * line - so the description can be written back with the definition on it,
 * exactly as the author had it, and the document-level pass skips what a
 * description already claimed.
 *
 * That is the same shape as the generated heading id: the tree already
 * distinguishes authored from derived, and the writer only had to ask
 * (carve-php#901, carve-js#738).
 */

import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const roundTrips = (source: string): boolean => carveToHtml(source) === carveToHtml(carveToCarve(source))

describe('a definition written inside a description', () => {
  it('is written back on its own line, byte for byte', () => {
    const src = ':: term\n:  [r]: /u\n\nsee [t][r]\n'
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('is written back for a footnote definition too', () => {
    const src = ':: term\n:  [^f]: x\n\nsee[^f]\n'
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('is not written twice', () => {
    // The document-level pass must skip what the description claimed; writing
    // both would define the label twice.
    const out = carveToCarve(':: term\n:  [r]: /u\n\nsee [t][r]\n')
    expect(out.match(/\[r\]: \/u/g)?.length).toBe(1)
  })

  it('leaves a definition written at document level where it was', () => {
    // The neighbouring case: no description claims it, so the writer's ordinary
    // placement is unchanged.
    expect(carveToCarve('[r]: /u\n\nsee [t][r]\n')).toBe('see [t][r]\n\n[r]: /u\n')
  })

  it('leaves an ordinary description alone', () => {
    expect(carveToCarve(':: term\n:  body\n')).toBe(':: term\n:  body\n')
  })

  it('leaves a footnote written at document level where it was', () => {
    expect(carveToCarve('[^f]: x\n\nsee[^f]\n')).toBe('see[^f]\n\n[^f]: x\n')
  })
})

/*
 * The cases above all have ONE entry, and every one of them happens to be
 * decided by the MINIMAL render. That hid a defect for as long as the shape
 * stayed that narrow.
 *
 * `renderCarve` renders the document TWICE - once minimally escaped, once
 * conservatively - and picks between them (PART 11 §4). The bookkeeping that
 * records "this description already wrote that definition" was allocated per
 * CALL, not per PASS, so the second pass found every definition already marked
 * as written: the description emitted a bare `:` again, and the document-level
 * arm, which returns '' for a marked node, emitted nothing either. The
 * definition was deleted outright.
 *
 * Whenever the conservative form wins - which a second entry is enough to
 * cause, because the writer does not re-emit the blank line between entries and
 * the minimal form therefore no longer re-parses to the tree it was given - the
 * document silently lost a link or footnote definition. `to_html(fmt(x)) ==
 * to_html(x)` (PART 11 §1) fails, and it fails by making a resolved reference
 * come back as literal text.
 *
 * No corpus document has two entries with an emptied description, so none of
 * this was visible in the corpus sweep.
 */
describe('an emptied description survives both escape passes', () => {
  it('is written back when another entry follows', () => {
    const src = ':: t1\n:  [r]: /u\n\n:: t2\n:  d2\n\nsee [t][r]\n'
    expect(carveToCarve(src)).toContain('[r]: /u')
    expect(roundTrips(src)).toBe(true)
  })

  it('is written back when it is the last entry', () => {
    const src = ':: t1\n:  d1\n\n:: t2\n:  [r]: /u\n\nsee [t][r]\n'
    expect(carveToCarve(src)).toContain('[r]: /u')
    expect(roundTrips(src)).toBe(true)
  })

  it('is written back for a footnote when another entry follows', () => {
    const src = ':: t1\n:  [^f]: x\n\n:: t2\n:  d2\n\nsee[^f]\n'
    expect(carveToCarve(src)).toContain('[^f]: x')
    expect(roundTrips(src)).toBe(true)
  })

  it('is written back inside a container', () => {
    // The line map is keyed on the DOCUMENT's hoisted definitions, so a
    // description nested in a container has to find its definition there too.
    const src = '::: note\n:: term\n:  [r]: /u\n:::\n\nsee [t][r]\n'
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('still writes the definition exactly once', () => {
    const out = carveToCarve(':: t1\n:  [r]: /u\n\n:: t2\n:  d2\n\nsee [t][r]\n')
    expect(out.match(/\[r\]: \/u/g)?.length).toBe(1)
  })
})
