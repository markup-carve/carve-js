import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A comment is INVISIBLE, so it may not produce output that the visible
 * construct it stands in for does not (markup-carve/carve-js#1545).
 *
 * A `%%` comment written inside a footnote body left an empty line in the
 * rendered `li` where the comment had been. The control - the same document
 * with a real blank line in place of the comment - emits no empty line, so an
 * invisible construct had an effect the visible one lacked, which inverts §24
 * C3 and L1b. markup-carve/carve#665 already ruled the sibling case, where an
 * engine "left a blank line inside the item where the attached definition used
 * to be".
 *
 * The bytes matter even though HTML collapses inter-block whitespace: the spec
 * corpus compares output byte for byte, so the row for this shape could not be
 * written while it stood. carve-php was correct here; carve-rs held the same
 * defect and was fixed alongside (markup-carve/carve-rs#1439).
 */
describe('a comment in a footnote body leaves no blank line in the output', () => {
  const commented = '[^b]: para\n      %% c\n      more\n\nuse[^b]\n'
  const control = '[^b]: para\n\n      more\n\nuse[^b]\n'

  it('renders the commented body exactly like the blank-line control', () => {
    expect(carveToHtml(commented)).toBe(carveToHtml(control))
  })

  it('emits no empty line between the two paragraphs of the note', () => {
    // Asserted on the bytes, not on a collapsed reading of them: an empty line
    // is what the corpus would diff on, and it is the whole defect.
    expect(carveToHtml(commented)).not.toMatch(/\n[ \t]*\n/)
    expect(carveToHtml(commented)).toContain('<p>para</p>\n      <p>more')
  })

  it('CONTROL: a comment between two top-level paragraphs also leaves none', () => {
    // This already passed, and pins that the fix is not a blanket whitespace
    // squeeze - it is what tells a real regression from this one.
    expect(carveToHtml('a\n%% c\n\nb\n')).toBe('<p>a</p>\n<p>b</p>')
  })
})
