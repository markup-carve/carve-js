import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Trailing flush-left plain text after a heading stays INSIDE the item the
 * heading belongs to when the heading was reached by a COLLECTED line — it used
 * to escape to a top-level paragraph, or attach as stray item text (carve#326).
 * What it no longer does is fold into the heading itself: a heading ends at its
 * newline (carve#451), so the line lands beside the heading as the item's own
 * content. Matches carve-php / carve-rs.
 *
 * "No matter how deeply that heading is nested" was the other half of this, and
 * markup-carve/carve#1280 withdrew it: a heading written ON a MARKER LINE is the
 * item's first block, it leaves no paragraph open, and PART 1 S4 gives the line
 * below it to the document instead (corpus category 326). The two halves have
 * opposite answers and both are pinned here, one row apart, because the
 * difference between them is one column of indentation.
 */
describe('a heading keeps trailing lazy text in its item', () => {
  it('an indented item heading after a blank keeps the lazy line', () => {
    expect(carveToHtml('- text\n\n  # N\nlazy')).toBe(
      '<ul>\n  <li>text\n    <h1 id="N">N</h1>\n    lazy\n  </li>\n</ul>',
    )
  })

  it('a nested marker-line heading ends every item in the stack', () => {
    // The heading is the sub-item's FIRST block and leaves no paragraph open, so
    // nothing in the open stack has one and the line reaches no container at all
    // (PART 1 S4, markup-carve/carve#1280). carve-rs `b6ff319c` produces this.
    expect(carveToHtml('- a\n  - # N\nlazy')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>lazy</p>',
    )
  })

  it('a deeply nested indented heading keeps the lazy line', () => {
    // Corpus 75-list-nesting-and-looseness-4, and the CONTROL for the row above:
    // the same heading one column further in is a line the sub-item COLLECTS
    // rather than its marker content, and S4 leaves that half folding. A change
    // that answered the marker-line case by making every heading close would
    // move this row.
    expect(carveToHtml('- a\n  - b\n    # N\nlazy')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <h1 id="N">N</h1>\n        lazy\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a blank after the heading still ends it', () => {
    expect(carveToHtml('- a\n  - # N\n\nsep')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>sep</p>',
    )
  })

  it('a caption line ends the item rather than joining it', () => {
    // A caption (`^ …`) is a heading terminator, so it ends the item's lazy
    // continuation instead of joining it, matching carve-php / carve-rs.
    expect(carveToHtml('- text\n\n  # H\n^ cap')).toBe(
      '<ul>\n  <li>text\n    <h1 id="H">H</h1>\n  </li>\n</ul>\n<p>^ cap</p>',
    )
  })

  it('a caption line ends a plain-paragraph item too', () => {
    expect(carveToHtml('- text\n^ cap')).toBe('<ul>\n  <li>text</li>\n</ul>\n<p>^ cap</p>')
  })
})
