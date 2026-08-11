/*
 * A definition attached by an INDENTED `+` continuation marker is collected
 * (carve-js#736).
 *
 * `plusAttached` was a boolean and the attached block's column was assumed to be
 * 0. §17 also lets the marker sit at an item's own content column, and the block
 * it attaches then sits at THAT column - so a definition under an indented `+`
 * matched no open column, was consumed by the item, and was registered by
 * nobody. The author's line vanished AND defined nothing, which is the
 * "neither visible nor active" outcome carve#624 named.
 *
 * It is the MARKER'S INDENT that decides it, not the nesting depth: a `+` at
 * column 0 already worked at either depth, and an indented `+` failed at either.
 *
 * The line rendering nothing is correct and unchanged - `+`-attached content
 * that renders nothing leaves no trace (corpus 226). What these tests pin is
 * that it was COLLECTED on its way out.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const resolves = (source: string): boolean => carveToHtml(source).includes('href="/u"')

const leavesNoTrace = (source: string): boolean => !carveToHtml(source).includes('[r]: /u')

describe('a definition attached by a continuation marker', () => {
  it('is collected when the marker is at column 0', () => {
    expect(resolves('- a\n+\n[r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('is collected when the marker sits at the item content column', () => {
    expect(resolves("- a\n  +\n\nsee [t][r]\n\n[r]: /u\n")).toBe(true)
  })

  it('is collected at a deeper nesting with an indented marker', () => {
    expect(resolves('- - a\n  +\n  [r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('is collected at a deeper nesting with a column-0 marker', () => {
    expect(resolves('- - a\n+\n[r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('is NOT collected below the marker column', () => {
    // The column is the rule, not "anything after a `+`". A line below it folds
    // as the item's visible text and registers nothing (§24 C3), which is what
    // keeps this from being a blanket exemption.
    expect(resolves('- a\n  +\n [r]: /u\n\nsee [t][r]\n')).toBe(false)
  })

  it('leaves no trace of the line it collected', () => {
    // The other half of the same rule (corpus 226): collected, and the item
    // keeps nothing where the line was.
    expect(leavesNoTrace("- a\n  +\n\nsee [t][r]\n\n[r]: /u\n")).toBe(true)
  })
})
