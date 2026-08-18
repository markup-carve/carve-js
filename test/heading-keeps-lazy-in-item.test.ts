import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A heading at an item's content column is a bounded block and leaves no
 * paragraph open. PART 1 S4 therefore closes that item before a flush-left line
 * (markup-carve/carve#1377), just as it already did for a marker-line heading.
 */
describe('a heading leaves no item paragraph open', () => {
  it('an indented item heading after a blank ends the item', () => {
    expect(carveToHtml('- text\n\n  # N\nlazy')).toBe(
      '<ul>\n  <li>text\n    <h1 id="N">N</h1>\n  </li>\n</ul>\n<p>lazy</p>',
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

  it('a deeply nested indented heading closes the inner item', () => {
    // Corpus 75-list-nesting-and-looseness-4. The outer item still owns the
    // flush-left line after the inner item closes.
    expect(carveToHtml('- a\n  - b\n    # N\nlazy')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <h1 id="N">N</h1>\n      </li>\n    </ul>\n    lazy\n  </li>\n</ul>',
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
