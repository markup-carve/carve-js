import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Marker-line sub-lists (Carve, deliberate divergence from djot).
 *
 * A sub-list opened on a list item's MARKER LINE (`- - A`, `* - A`,
 * `1. - A`, ...) behaves like a NORMAL persistent nested list: it MERGES
 * following same-indent list items into one inner list, and stays OPEN to
 * ABSORB post-blank indented blocks into its items (any cell, including the
 * first). Djot instead line-scopes the marker-line case -- splitting it from
 * following same-indent items and leaking later indented blocks to the parent
 * row. Carve reuses its existing nested-list / absorption path for both the
 * marker-line and following-line cases. Target semantics match CommonMark.
 */
describe('marker-line sub-lists', () => {
  it('merges three cells into ONE inner list (no split)', () => {
    // `* - A` / `  - B` / `  - C` -> outer item holds a single inner list
    // [A, B, C], not [A] + [B, C].
    expect(h('* - A\n  - B\n  - C')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>A</li>\n      <li>B</li>\n      <li>C</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('merges with the `-` bullet on the marker line too', () => {
    expect(h('- - A\n  - B\n  - C')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>A</li>\n      <li>B</li>\n      <li>C</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('absorbs a post-blank indented paragraph into the FIRST cell', () => {
    // `* - A` / blank / `    second` / `  - B` -> inner list [A, B] where A
    // holds two paragraphs (A + "second"); the block does NOT leak to the row.
    expect(h('* - A\n\n    second\n  - B')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li><p>A</p>\n        <p>second</p>\n      </li>\n      <li><p>B</p></li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('absorbs a post-blank block opener (blockquote) into the FIRST cell', () => {
    // The quote indented to the first cell's content column belongs to that
    // cell, not the parent row.
    expect(h('- - A\n\n    > quote\n  - B')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>A\n        <blockquote><p>quote</p></blockquote>\n      </li>\n      <li>B</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('merges when the marker-line child carries an abutting attribute', () => {
    // The abutting item-attribute marker (`-{.x} A`) is a list marker too, so
    // the following `- B` merges into the same inner list.
    expect(h('- -{.x} A\n  - B')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li class="x">A</li>\n      <li>B</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
