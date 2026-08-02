import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A flush-left line after a nested heading stays INSIDE the item that heading
 * belongs to, no matter how deeply that item is nested. It used to escape to a
 * top-level paragraph or attach as stray item text (carve#326).
 *
 * Under SINGLE-LINE HEADINGS (PART 2) it no longer folds INTO the heading - a
 * heading ends at the newline - so it lands as the item's own content, which in
 * a tight list renders unwrapped. Ownership is the invariant these cases pin;
 * spec corpus 73-list-nesting-and-looseness-4 pins the same shape.
 */
describe('a lazy line after a nested heading stays in the item', () => {
  it('an indented item heading after a blank keeps the lazy line in the item', () => {
    expect(carveToHtml('- text\n\n  # N\nlazy')).toBe(
      '<ul>\n  <li>text\n    <h1 id="N">N</h1>\n    lazy\n  </li>\n</ul>',
    )
  })

  it('a nested marker-line heading keeps the lazy line in the item', () => {
    expect(carveToHtml('- a\n  - # N\nlazy')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n        lazy\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a deeply nested indented heading keeps the lazy line in the item', () => {
    expect(carveToHtml('- a\n  - b\n    # N\nlazy')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <h1 id="N">N</h1>\n        lazy\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('the nested heading id comes from its own line alone', () => {
    // Under folding this id was `N-lazy`, silently keyed to text the author
    // never put in the title.
    expect(carveToHtml('- a\n  - b\n    # N\nlazy')).toContain('id="N"')
  })

  it('a blank after the heading still ends the list', () => {
    expect(carveToHtml('- a\n  - # N\n\nsep')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>sep</p>',
    )
  })

  it('a caption line ends the item', () => {
    expect(carveToHtml('- text\n\n  # H\n^ cap')).toBe(
      '<ul>\n  <li>text\n    <h1 id="H">H</h1>\n  </li>\n</ul>\n<p>^ cap</p>',
    )
  })

  it('a caption line ends a plain-paragraph item too', () => {
    expect(carveToHtml('- text\n^ cap')).toBe('<ul>\n  <li>text</li>\n</ul>\n<p>^ cap</p>')
  })
})
