import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#322: a post-blank block in a NESTED item must not loosen the OUTER
// item. Looseness is decided per level, not propagated up from a descendant.
// Correct behaviour = carve-php / carve-rs (verified byte-identical).
describe('nested item looseness does not propagate to the outer item (carve#322)', () => {
  it('inner post-blank block keeps the outer item tight', () => {
    // outer `a` is bare (tight), only inner `b` carries the block.
    expect(carveToHtml('- a\n  - b\n\n    > q\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <blockquote><p>q</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('sibling-blank invariant: inner loose, outer tight (was already correct)', () => {
    expect(carveToHtml('- a\n  - b\n\n  - c\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li><p>b</p></li>\n      <li><p>c</p></li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('inner post-blank paragraph loosens only the inner item', () => {
    expect(carveToHtml('- a\n  - b\n\n    text\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li><p>b</p>\n        <p>text</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('three levels: outer ancestors stay tight', () => {
    expect(carveToHtml('- a\n  - b\n    - c\n\n      > q\n')).toContain('<li>a\n    <ul>')
  })

  it("the outer item's OWN blank+paragraph still loosens it (no over-correction)", () => {
    expect(carveToHtml('- a\n\n  text\n')).toBe('<ul>\n  <li><p>a</p>\n    <p>text</p>\n  </li>\n</ul>')
  })

  it("the outer item's OWN blank+sub-block keeps it tight", () => {
    expect(carveToHtml('- a\n\n  > q\n')).toContain('<li>a\n    <blockquote>')
  })

  it('an above-content-column lazy paragraph still loosens the item (§24 C3)', () => {
    expect(carveToHtml('- one\n\n   # h\n')).toBe('<ul>\n  <li><p>one</p>\n    <p># h</p>\n  </li>\n</ul>')
  })

  it('a nested TASK item (content column is the bullet width, not the checkbox) keeps the outer tight', () => {
    // The sub-list content column is 2 (`- `), not 6 (`- [ ] `), so the
    // post-blank paragraph belongs to the task sub-item, not the outer item.
    expect(carveToHtml('- a\n  - [ ] b\n\n    text\n')).toContain('<li>a\n    <ul>')
  })
})
