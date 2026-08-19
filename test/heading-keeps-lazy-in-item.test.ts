import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A heading at an item's content column is a bounded block and leaves no
 * paragraph open. PART 1 S4 therefore closes that item before a flush-left line
 * (markup-carve/carve#1377), just as it already did for a marker-line heading.
 */
describe('a heading keeps trailing lazy text in its item', () => {
  it('an indented item heading after a blank keeps the lazy line', () => {
    expect(carveToHtml("- text\n+\n# N\n+\nlazy\n")).toBe(
      '<ul>\n  <li>text\n    <h1 id="N">N</h1>\n    lazy\n  </li>\n</ul>',
    )
  })

  it('a nested marker-line heading keeps the lazy line', () => {
    expect(carveToHtml("- a\n  - # N\n    lazy\n")).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n        lazy\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a deeply nested indented heading keeps the lazy line', () => {
    // Corpus 73-list-nesting-and-looseness-4: a paragraph in the item, rendered
    // unwrapped because the list is tight.
    expect(carveToHtml("- a\n  - b\n  +\n  # N\n  +\n  lazy\n")).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <h1 id="N">N</h1>\n        lazy\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a blank after the heading still ends it', () => {
    expect(carveToHtml("- a\n  - # N\n\nsep\n")).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>sep</p>',
    )
  })

  it('a caption line ends the item rather than joining it', () => {
    // A caption (`^ …`) is a heading terminator, so it ends the item's lazy
    // continuation instead of joining it, matching carve-php / carve-rs.
    expect(carveToHtml("- text\n+\n# H\n\n^ cap\n")).toBe(
      '<ul>\n  <li>text\n    <h1 id="H">H</h1>\n  </li>\n</ul>\n<p>^ cap</p>',
    )
  })

  it('a caption line ends a plain-paragraph item too', () => {
    expect(carveToHtml("- text\n\n^ cap\n")).toBe('<ul>\n  <li>text</li>\n</ul>\n<p>^ cap</p>')
  })
})
