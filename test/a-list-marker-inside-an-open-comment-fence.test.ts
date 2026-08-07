import { describe, it, expect } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

/**
 * A list marker at an item's content column, INSIDE a COMMENT fence that item
 * opened, is comment body (markup-carve/carve-js#878).
 *
 * PART 9 §28 makes a comment fence's body VERBATIM, and PART 9 §24's S1 MATCH
 * PREFIXES and S2 FENCED BODY place a line by the COLUMN it reaches - neither
 * reads the line's first character. That is exactly the derivation
 * markup-carve/carve#975 pinned for the CODE fence as corpus category 278, one
 * construct over: once the walk has matched the item and landed in the fenced
 * body, `- x` at the content column is the same continuation a plain `x` is.
 * The rule was never in doubt here; only the pin was missing.
 *
 * BEFORE, the body LEAKED ONTO THE PAGE. The marker test in each collection
 * loop consulted `inFence` and not `inComment`, so the marker split the item's
 * collected lines into a lead stream and a block stream: the opener was left
 * alone in the lead stream, `- x` opened a NESTED LIST in the block stream, and
 * the closer trailed it - three nodes out of a construct §28 makes invisible.
 *
 * `fmt` THEN WROTE `%% %`. That is one defect, not two. Each severed `%%%`
 * became an UNTERMINATED comment fence, which §28 degrades to an inline `%%`
 * comment whose content is the leftover `%`; the writer re-spelled that node
 * faithfully as `%% %`. The document no longer round-tripped: `fmt` was not
 * idempotent on it, which is what these tests assert alongside the parse.
 *
 * TWO SOURCES OF COMMENT STATE FEED THREE MARKER TESTS HERE. The indented body
 * reaches `inComment` from the marker line itself (the carve#950 case, which
 * for the comment fence had no lead-line branch at all) and from a line after a
 * blank (the tracker's own comment branch). The `+` continuation marker
 * attaches a FLUSH-LEFT block through two further loops with their own marker
 * tests, and both severed a comment body identically. The corpus does not reach
 * the `+` loops, so they are pinned here with their plain-body controls beside
 * them.
 */

// A comment renders nothing, so every document whose whole item body is one
// comment renders an EMPTY item. That is the shape the plain-body spelling one
// column over already produced, and the marker spelling has to reach it too.
const emptyItem = '<ul>\n  <li></li>\n</ul>'

describe('a list marker at the content column inside an open comment fence', () => {
  it('is comment body when the fence opened on the marker line', () => {
    expect(carveToHtml('- %%%\n  - x\n  %%%\n').trim()).toBe(emptyItem)
  })

  it('is comment body when the fence opened after a blank line', () => {
    expect(carveToHtml('- a\n\n  %%%\n  - x\n  %%%\n').trim()).toBe(
      '<ul>\n  <li>a</li>\n</ul>',
    )
  })

  it('reads the same as the plain-text spelling one column over', () => {
    // The two documents differ by two characters. Both must land on the same
    // shape, or the marker is being read where §24 reads only a column.
    expect(carveToHtml('- %%%\n  x\n  %%%\n').trim()).toBe(emptyItem)
    expect(carveToHtml('- a\n\n  %%%\n  x\n  %%%\n').trim()).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('holds for every marker spelling, not just the bullet', () => {
    expect(carveToHtml('- %%%\n  1. x\n  %%%\n').trim()).toBe(emptyItem)
    expect(carveToHtml('- %%%\n  - [x] x\n  %%%\n').trim()).toBe(emptyItem)
    // The abutting-attribute bullet is a marker to the same test, so it needs
    // the same guard.
    expect(carveToHtml('- %%%\n  -{.c} x\n  %%%\n').trim()).toBe(emptyItem)
  })

  it('holds for a longer fence, and for an opener carrying an info string', () => {
    // §28 gives the opener an INSIGNIFICANT TAIL, so `%%% note` opens; the
    // closer matches on EXACT length, so `%%%` inside `%%%%` is body.
    expect(carveToHtml('- %%%%\n  - x\n  %%%%\n').trim()).toBe(emptyItem)
    expect(carveToHtml('- %%% note\n  - x\n  %%%\n').trim()).toBe(emptyItem)
    expect(carveToHtml('- %%%%\n  - x\n  %%%\n  %%%%\n').trim()).toBe(emptyItem)
  })

  it('holds under an ordered item and one list level down', () => {
    expect(carveToHtml('1. %%%\n   - x\n   %%%\n').trim()).toBe('<ol>\n  <li></li>\n</ol>')
    expect(carveToHtml('- - %%%\n    - x\n    %%%\n').trim()).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('keeps the residual columns of an over-indented marker as comment body', () => {
    expect(carveToHtml('- %%%\n    - x\n  %%%\n').trim()).toBe(emptyItem)
  })

  it('applies to the flush-left block a `+` first-block item attaches', () => {
    // Control first: the same document with plain body text. The two must
    // agree, for the reason the marker and plain spellings above must.
    expect(carveToHtml('- +\n%%%\nx\n%%%\n').trim()).toBe(emptyItem)
    expect(carveToHtml('- +\n%%%\n- x\n%%%\n').trim()).toBe(emptyItem)
  })

  it('applies to the flush-left block a mid-item `+` attaches', () => {
    expect(carveToHtml('- a\n+\n%%%\nx\n%%%\n').trim()).toBe('<ul>\n  <li>a</li>\n</ul>')
    expect(carveToHtml('- a\n+\n%%%\n- x\n%%%\n').trim()).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('CONTROL: a marker AFTER the comment closes still opens a sub-list', () => {
    // The guard is on the OPEN comment, so closing it must restore the marker.
    // A guard written as "the item opened a comment fence anywhere" passes
    // every case above and fails this one.
    expect(carveToHtml('- %%%\n  y\n  %%%\n  - x\n').trim()).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('CONTROL: an UNTERMINATED opener is no comment block, so the marker nests', () => {
    // §28 gives a `%%%` opener with no closer ahead to the inline `%%` rule,
    // and the block parser does exactly that. A guard that ignored the closer
    // would swallow the marker here.
    expect(carveToHtml('- %%%\n  - x\n').trim()).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('CONTROL: a two-`%` line is an inline comment, not a fence', () => {
    // A comment FENCE is three or more `%`. `- %%` opens nothing, so the
    // marker below it nests as it always did.
    expect(carveToHtml('- %%\n  - x\n  %%\n').trim()).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('CONTROL: a base-column marker below the opener is still a sibling item', () => {
    expect(carveToHtml('- %%%\n- x\n').trim()).toBe('<ul>\n  <li></li>\n  <li>x</li>\n</ul>')
  })

  it('survives fmt: the writer re-emits one comment fence, not `%% %`', () => {
    // The marker split left each `%%%` an unterminated fence, which the writer
    // spelled `%% %` - a three-character delimiter broken across a space, and a
    // document that no longer round-tripped.
    expect(renderCarve(parse('- %%%\n  - x\n  %%%\n'))).toBe('- %%%\n  - x\n  %%%\n')
    for (const src of [
      '- %%%\n  - x\n  %%%\n',
      '- a\n\n  %%%\n  - x\n  %%%\n',
      '- +\n%%%\n- x\n%%%\n',
      '- a\n+\n%%%\n- x\n%%%\n',
      '- %%%%\n  - x\n  %%%\n  %%%%\n',
    ]) {
      const written = renderCarve(parse(src))
      expect(written).not.toContain('%% %')
      expect(carveToHtml(written)).toBe(carveToHtml(src))
      expect(renderCarve(parse(written))).toBe(written)
    }
  })
})
