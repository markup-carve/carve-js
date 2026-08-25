import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * An attribute block attaches to the block that follows it, and a NESTED LIST
 * is a block (`markup-carve/carve#1238`, `markup-carve/carve-js#1100`).
 *
 * PART 2's LIST-ITEM ATTRIBUTES clause already says it in as many words: a
 * `{.c}` alone on its own line inside an item "is a block-attribute line that
 * floats to the next block within the item", and it names the indented
 * `> quote` only as an EXAMPLE of such a block, not as the list of them. A
 * nested list is one too, so the attributes land on the sub-`<ul>`/`<ol>` -
 * not on the `<li>` (only the abutting `-{.c}` marker form does that) and not
 * on the outer list.
 *
 * carve-js dropped them, silently, for one reason: the block parser owns ONE
 * pending-attribute slot per stream, and `parseList` splits an item's collected
 * lines at the first sub-list marker so the list parser can own the sub-list
 * and its looseness bookkeeping. The attribute line ended the FIRST stream as a
 * dangling run - which §15 drops - while the sub-list opened the SECOND one
 * with an empty slot. A paragraph, quote or fence in the same position is not a
 * marker, so nothing split there and those cases always attached. That is why
 * the nested list was the only block type in an item that lost its attributes.
 *
 * The blank line decides nothing here, and no rule keys on it: with no blank
 * line an attribute before a PARAGRAPH inside an item already attached before
 * this fix. Both spellings are pinned below, and the neighbouring block types
 * are pinned as controls so a future change cannot buy one row by breaking
 * another.
 */
describe('an attribute block before a nested list (carve#1238)', () => {
  it('attaches to the sub-list across a blank line (row B)', () => {
    expect(h('- a\n\n  {.x}\n  - b\n')).toBe(
      '<ul>\n  <li>a\n    <ul class="x">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('attaches to the sub-list with no blank line (row C)', () => {
    expect(h('- a\n  {.x}\n  - b\n')).toBe(
      '<ul>\n  <li>a\n    <ul class="x">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('attaches when the attribute line is the TAIL of a chunk that also holds content', () => {
    // A fix keyed on "the whole chunk is an attribute block" repairs the two
    // rows above and leaves this one broken, which reads as arbitrary: the
    // author wrote the same three characters directly above the same marker.
    expect(h('- a\n  para\n  {.x}\n  - b\n')).toBe(
      '<ul>\n  <li>a\npara\n    <ul class="x">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('attaches to an ORDERED sub-list', () => {
    expect(h('- a\n\n  {.x}\n  1. b\n')).toBe(
      '<ul>\n  <li>a\n    <ol class="x">\n      <li>b</li>\n    </ol>\n  </li>\n</ul>',
    )
  })

  it('attaches to a TASK sub-list', () => {
    expect(h('- a\n\n  {.x}\n  - [ ] b\n')).toBe(
      '<ul>\n  <li>a\n    <ul class="x">\n      <li><input type="checkbox" disabled aria-label="b"> b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('attaches at a DEEPER nesting level, where the same split repeats', () => {
    expect(h('- a\n  - b\n\n    {.x}\n    - c\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul class="x">\n          <li>c</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('carries an id, and merges a stacked run of attribute lines (§15 A3)', () => {
    expect(h('- a\n\n  {#sub}\n  - b\n')).toBe(
      '<ul>\n  <li>a\n    <ul id="sub">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(h('- a\n\n  {.x}\n  {#i}\n  - b\n')).toBe(
      '<ul>\n  <li>a\n    <ul class="x" id="i">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('floats PAST an invisible construct to reach the sub-list (§15 A2a)', () => {
    // A comment renders nothing, so it is not "the next block" - the same rule
    // that already applied when the next block was a paragraph.
    expect(h('- a\n\n  {.x}\n  %% note\n  - b\n')).toBe(
      '<ul>\n  <li>a\n    <ul class="x">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it.each([
    ['blank line', '- a\n\n  {.x}\n  - b\n', '- a\n  {.x}\n  - b\n'],
    ['no blank line', '- a\n  {.x}\n  - b\n', '- a\n  {.x}\n  - b\n'],
    [
      'attribute line after the item prose',
      '- a\n  para\n  {.x}\n  - b\n',
      '- a\n  para\n  {.x}\n  - b\n',
    ],
    ['id, class and key together', '- a\n\n  {#s .y k=v}\n  1. b\n', '- a\n  {#s .y k=v}\n  1. b\n'],
  ])('survives the formatter (%s)', (_name, src, expected) => {
    // The formatter round-trip is only worth asserting because the attributes
    // are in the tree to begin with: `carveToHtml(fmt(x)) === carveToHtml(x)`
    // held even while both sides dropped them. The written form is what pins
    // it - the `{...}` line has to come back out.
    const formatted = carveToCarve(src)
    expect(formatted).toBe(expected)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it('attaches to the sub-list, NOT to the <li> and NOT to the outer list', () => {
    const out = h('- a\n\n  {.x}\n  - b\n')
    expect(out).toContain('<ul class="x">')
    expect(out.startsWith('<ul>\n')).toBe(true)
    expect(out).not.toContain('<li class="x">')
    expect(out).not.toContain('<ul class="x">\n  <li>a')
  })
})

describe('the blocks that already attached keep attaching (controls)', () => {
  it.each([
    ['paragraph after a blank', '- a\n\n  {.x}\n  para\n', '<p class="x">para</p>'],
    ['paragraph with no blank', '- a\n  {.x}\n  para\n', '<p class="x">para</p>'],
    ['block quote', '- a\n\n  {.x}\n  > q\n', '<blockquote class="x">'],
    ['code fence', '- a\n\n  {.x}\n  ```\n  code\n  ```\n', '<pre class="x">'],
  ])('%s', (_name, src, expected) => {
    expect(h(src)).toContain(expected)
  })

  it('row A: an attribute line before a TOP-LEVEL list attaches to the list', () => {
    expect(h('{.x}\n- b\n')).toBe('<ul class="x">\n  <li>b</li>\n</ul>')
  })

  it('row H: a paragraph, an attribute line, then a top-level list', () => {
    expect(h('para\n{.x}\n- b\n')).toBe('<p>para</p>\n<ul class="x">\n  <li>b</li>\n</ul>')
  })

  it('the abutting `-{.x}` marker form still attributes the <li>, at every level', () => {
    // A different mechanism targeting a different element (PART 2, LIST-ITEM
    // ATTRIBUTES). It was correct before and must be untouched.
    expect(h('-{.x} item\n')).toBe('<ul>\n  <li class="x">item</li>\n</ul>')
    expect(h('- a\n  -{.y} b\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li class="y">b</li>\n    </ul>\n  </li>\n</ul>',
    )
    // Both forms at once: the block line attributes the sub-list, the abutting
    // block attributes the item inside it.
    expect(h('- a\n\n  {.x}\n  -{.y} b\n')).toBe(
      '<ul>\n  <li>a\n    <ul class="x">\n      <li class="y">b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a brace ONE COLUMN IN is a continuation line, not an attribute block', () => {
    // The strict column-0 rule (§15). Three spaces under `- ` is above the
    // item's content column, so the line is paragraph text and the sub-list
    // takes nothing. A fix that trims indentation before looking for the brace
    // deletes this paragraph and re-tightens the item.
    expect(h('- a\n\n   {.c}\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
    expect(h('- a\n\n   {.c}\n  - b\n')).toBe(
      '<ul>\n  <li>a\n    <ul class="c">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a closed fence keeps its body verbatim, braces and markers alike', () => {
    expect(h('- a\n  ```\n  {.x}\n  - b\n  ```\n')).toBe(
      '<ul>\n  <li>a\n    <pre><code>{.x}\n- b\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('an attribute line with nothing after it inside the item is still dropped (§15 A4)', () => {
    // The sibling list one column out is a different container, not "the next
    // block within the item", so the run really has nowhere to go.
    const out = h('- a\n\n  {.x}\n- b\n')
    expect(out).toBe('<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>')
    expect(out).not.toContain('{.x}')
  })
})

describe('tightness does not move (PART 9 §17 L1/L2)', () => {
  it('L2: a blank before an attributed sub-list leaves the item TIGHT', () => {
    // "A blank line before an item's sub-BLOCK ... does NOT loosen: the item
    // stays tight, lead text inline, block attached." Attaching the attributes
    // must not turn the sub-list into something that loosens.
    expect(h('- a\n\n  {.x}\n  - b\n')).toContain('<li>a\n')
    expect(h('- a\n\n  {.x}\n  - b\n')).not.toContain('<li><p>a</p>')
  })

  it('L1: a blank between siblings still loosens the outer list', () => {
    expect(h('- a\n\n  {.x}\n  - b\n\n- c\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <ul class="x">\n      <li>b</li>\n    </ul>\n  </li>\n  <li><p>c</p></li>\n</ul>',
    )
  })

  it('a real second paragraph after the attribute line still loosens', () => {
    expect(h('- a\n\n  {.x}\n  para\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <p class="x">para</p>\n  </li>\n</ul>',
    )
  })
})
