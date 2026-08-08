import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * A block-attribute line below a list item ends the item, and the attribute
 * floats forward (`markup-carve/carve#1028`).
 *
 * PART 9 §10 I5 names the three invisible constructs that INTERRUPT an open
 * paragraph and are consumed - "a reference definition ..., a comment ..., and
 * a block-attribute line (`{…}` alone on a line, §15)" - and I6 applies the
 * relation to EVERY open paragraph, "including a blockquote's lazy
 * continuation". An item's lead paragraph is one of those.
 *
 * `lazyContinuationEndsList` carried an arm for the two definition kinds and
 * for the comment fence, and none for the attribute line, so
 *
 *     - item
 *     {.cls}
 *     > quote
 *
 * folded `{.cls}` INTO the item. Inside the item it was collected as a pending
 * attribute with no following block, and §15 drops a dangling run - so the
 * author's attribute reached neither the `<li>` nor the quote and rendered
 * NOWHERE. It is not the canonical spelling that convicts this: whatever the
 * attribute is, it has to arrive somewhere or stay on the page as text.
 *
 * PART 2's LIST-ITEM ATTRIBUTES clause names this exact behavior and rejects it
 * by engine: "The lazy-continuation accident - a trailing `{…}` line folded onto
 * a tight item, which carve-php attached to the `<li>` and carve-js dropped - is
 * REJECTED as the mechanism". Both halves of that sentence were still true when
 * this test was written.
 */
describe('a block-attribute line below a list item (§10 I5)', () => {
  it('ends the item and floats onto the next block', () => {
    expect(h('- item\n{.cls}\n> quote\n')).toBe(
      '<ul>\n  <li>item</li>\n</ul>\n<blockquote class="cls"><p>quote</p></blockquote>',
    )
  })

  it('floats onto a following paragraph the same way', () => {
    expect(h('- item\n{.cls}\npara\n')).toBe(
      '<ul>\n  <li>item</li>\n</ul>\n<p class="cls">para</p>',
    )
  })

  it('is dropped when nothing follows it, rather than printed as item text', () => {
    const out = h('- item\n{.cls}\n')
    expect(out).toBe('<ul>\n  <li>item</li>\n</ul>')
    expect(out).not.toContain('{.cls}')
  })

  it('leaves an INDENTED attribute line inside the item, where it attributes the item body', () => {
    // The control: at the item's content column the line is the item's, and §15
    // floats it onto the item's own next block. The fix must not reach this.
    expect(h('- item\n  {.cls}\n  > quote\n')).toBe(
      '<ul>\n  <li>item\n    <blockquote class="cls"><p>quote</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('keeps a `{` line that is NOT valid attribute syntax as item text', () => {
    // §15's own disambiguation: an INVALID block is not an attribute line, so it
    // stays lazy item content and must still fold. `{# id}` - a space-broken id
    // - is one; `{not attrs}` is NOT, because two boolean attributes are a valid
    // block and all three engines drop it as dangling.
    expect(h('- item\n{# id}\n')).toBe('<ul>\n  <li>item\n{# id}</li>\n</ul>')
  })
})
