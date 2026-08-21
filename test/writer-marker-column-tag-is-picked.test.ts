import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * The writer's MARKER-COLUMN tag is picked with the rest of the run, not fixed.
 *
 * `renderListItem` prefixes every continuation line of a list item with a tag,
 * and `renderList` strips it back off BY POSITION - a line that starts with it.
 * The tag was the fixed U+E005, so a continuation line the AUTHOR started with
 * U+E005 answered that test: the character was eaten AND the line was written
 * back at the item's marker column instead of its content column, which walks
 * the paragraph out of the list item. That is a change to the document's BLOCK
 * STRUCTURE, so PART 11 §1 - `toHtml(fmt(x)) == toHtml(x)` - failed with it
 * (carve-js#1280).
 *
 * The same rule carve#678 settled for the verbatim sentinels: a FIXED code point
 * cannot be told apart from an authored one. The remedy was already in this
 * file - `pickSentinels` - so the tag joins the run it was sitting beside rather
 * than getting a scheme of its own. Beside it was also where the two could
 * collide with EACH OTHER: U+E005 is the run's fifth slot, §11 N1a's list
 * boundary.
 *
 * Every character here is written as a code point rather than as a literal: a
 * private-use character is invisible in a rendered string, which is exactly how
 * the defect hid.
 */

const at = (code: number): string => String.fromCharCode(code)

/** `- item` with a loose continuation paragraph that OPENS with `lead`. */
const itemContinuation = (lead: string): string => `- item\n\n  ${lead}cont\n`

describe('an authored private-use character opening a continuation line', () => {
  for (let code = 0xe001; code <= 0xe00a; code++) {
    const label = `U+${code.toString(16).toUpperCase()}`

    it(`keeps ${label} and leaves the paragraph inside the item`, () => {
      const src = itemContinuation(at(code))
      const written = carveToCarve(src)

      // The character survives the round trip...
      expect(written).toContain(at(code))
      // ...and so does the block structure. This is the half that made the
      // defect worth a ticket: U+E005 came back with the paragraph dedented
      // out of the list.
      expect(carveToHtml(written)).toBe(carveToHtml(src))
    })
  }

  /** The code points `from`..`to`, joined. */
  const run = (from: number, to: number): string => {
    let text = ''
    for (let code = from; code <= to; code++) text += at(code)
    return text
  }

  for (const [name, occupied] of [
    ['the preferred run', run(0xe001, 0xe006)],
    ['the preferred run and the first fallback run', run(0xe001, 0xe00c)],
  ] as const) {
    for (let code = 0xe001; code <= 0xe012; code++) {
      const label = `U+${code.toString(16).toUpperCase()}`

      it(`keeps ${label} opening a continuation line while the item text occupies ${name}`, () => {
        // The rows above cannot fail for a tag the writer has been pushed OFF
        // its default by the document. These can: the item text occupies the
        // run the writer reaches for, so the tag lands somewhere in the scan,
        // and the continuation opens with every candidate in turn.
        const src = `- item${occupied}\n\n  ${at(code)}cont\n`
        const written = carveToCarve(src)

        expect(written).toContain(at(code))
        expect(carveToHtml(written)).toBe(carveToHtml(src))
      })
    }
  }
})

describe('the marker-column tag still does its job', () => {
  it('writes the continuation marker at the item MARKER column (carve#861)', () => {
    // THE CONTROL. §17 L3 puts `+` and the block it attaches at the container's
    // marker column, not at its content column. A run that satisfied the rows
    // above by DELETING the tag mechanism re-breaks this one.
    const src = '- a\n\n+ b\n'

    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('keeps a plain continuation paragraph at the item CONTENT column', () => {
    // The other side of the same control: with no tag on the line, the
    // continuation is indented into the item.
    const src = '- item\n\n  cont\n'

    expect(carveToCarve(src)).toBe(src)
  })

  it('writes the marker even when the document occupies the preferred run', () => {
    // The carve#861 shape and a re-picked run together: moving the tag must not
    // move the column it marks.
    let text = ''
    for (let code = 0xe001; code <= 0xe006; code++) text += at(code)
    const src = `- a${text}\n\n+ b\n`

    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })
})
