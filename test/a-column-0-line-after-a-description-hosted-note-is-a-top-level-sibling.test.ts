import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A COLUMN-0 LINE AFTER A DESCRIPTION-HOSTED NOTE IS A TOP-LEVEL SIBLING
 * (markup-carve/carve#1974, the same column-reach model that settled
 * carve#1946 / carve#1971 / carve#1972).
 *
 * A footnote definition written on a description marker line takes the list
 * opener at its own floor: the `dd` content column is 3, `[^f]` stands at
 * column 3, PART 9 §16 puts its body floor at 5, and the `- nested` opener at
 * column 5 reaches the note body. The note is never referenced, so it drops.
 * What remains is where the trailing line goes, and that is decided by its
 * column:
 *
 *   - `tail` at column 0 is at or below the `dd`'s base column, so PART 0's
 *     owner-selection gives it to the nearest surviving ancestor - the
 *     document. djot and markdown both read it this way.
 *   - `tail` at the `dd`'s own content column (3) can continue the open note
 *     paragraph and leaves no visible description content.
 *
 * The note's open paragraph now also takes plain lazy lines below its floor.
 */

describe('a column-0 line after a description-hosted note is a top-level sibling', () => {
  // The FIX: the opener reaches the note floor, the note drops, and the
  // flush-left trailing line falls out of the `dd` to the document.
  it('drops a column-0 trailing line to a top-level paragraph', () => {
    expect(carveToHtml(':: t\n:  [^f]: note\n     - nested\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>tail</p>',
    )
  })

  // A line at the description column can still continue the open note.
  it('keeps a trailing line at the dd column in the note', () => {
    expect(carveToHtml(':: t\n:  [^f]: note\n     - nested\n   tail\n')).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>",
    )
  })

  // A marker below the note floor folds into its open paragraph.
  it('folds an opener one column shy of the note floor', () => {
    expect(carveToHtml(':: t\n:  [^f]: note\n    - nested\ntail\n')).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>",
    )
  })
})
