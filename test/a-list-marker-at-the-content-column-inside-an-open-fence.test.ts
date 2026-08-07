import { describe, it, expect } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

/**
 * A list marker at an item's content column, INSIDE a fence that item opened,
 * is code text (markup-carve/carve#975 category 278, markup-carve/carve-php#1007).
 *
 * PART 9 §24's S1 MATCH PREFIXES and S2 FENCED BODY place a line by the COLUMN
 * it reaches. Neither reads the line's first character. So once the walk has
 * matched the item and landed in its fenced body, `- x` at the content column
 * is the same continuation that a plain `x` is - which corpus
 * `276-a-fence-opened-on-a-list-marker-line-body-below-the-content-column-3`
 * already pinned, and which differs from category 278's first row by exactly
 * two characters.
 *
 * THE MARKER TEST HAD NO FENCE GUARD, so the marker line split the item's
 * collected lines into a lead stream and a block stream at that point. The
 * opener was left alone in the lead stream as an EMPTY code block, the marker
 * line opened a nested list in the block stream, and the closer trailed it as
 * an inline code span - three wrong nodes from one missing condition.
 *
 * THE RULE HAS THREE COLLECTION LOOPS IN THIS ENGINE, NOT THE TWO THE CORPUS
 * IMPLIES. Category 278's two rows separate the two ways the INDENTED body's
 * fence state gets set - on the marker line, and on a line after a blank - and
 * both feed one marker test. The `+` continuation marker attaches a FLUSH-LEFT
 * block instead, through two further loops with their own marker tests, and
 * both severed a fence body the same way. The corpus does not reach them, so
 * they are pinned here.
 */

const item = (body: string) => `<ul>\n  <li>\n    <pre><code>${body}\n</code></pre>\n  </li>\n</ul>`

describe('a list marker at the content column inside an open fence', () => {
  it('is code text when the fence opened on the marker line (corpus row 1)', () => {
    expect(carveToHtml('- ```\n  - x\n  ```\n').trim()).toBe(item('- x'))
  })

  it('is code text when the fence opened after a blank line (corpus row 2)', () => {
    expect(carveToHtml('- a\n\n  ```\n  - x\n  ```\n').trim()).toBe(
      '<ul>\n  <li>a\n    <pre><code>- x\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('reads the same as the plain-text spelling one column over', () => {
    // The 276 row this differs from by two characters. Both must land on the
    // same shape, or the marker is being read where §24 reads only a column.
    expect(carveToHtml('- ```\n  x\n  ```\n').trim()).toBe(item('x'))
  })

  it('holds for every marker spelling, not just the bullet', () => {
    expect(carveToHtml('- ```\n  1. x\n  ```\n').trim()).toBe(item('1. x'))
    expect(carveToHtml('- ```\n  - [x] x\n  ```\n').trim()).toBe(item('- [x] x'))
    // The abutting-attribute bullet is a marker to the same test, so it needs
    // the same guard.
    expect(carveToHtml('- ```\n  -{.c} x\n  ```\n').trim()).toBe(item('-{.c} x'))
  })

  it('holds for a tilde fence and a raw fence', () => {
    expect(carveToHtml('- ~~~\n  - x\n  ~~~\n').trim()).toBe(item('- x'))
    expect(carveToHtml('- ```=html\n  - x\n  ```\n').trim()).toBe(
      '<ul>\n  <li>\n    - x\n  </li>\n</ul>',
    )
  })

  it('holds under an ordered item and one list level down', () => {
    expect(carveToHtml('1. ```\n   - x\n   ```\n').trim()).toBe(
      '<ol>\n  <li>\n    <pre><code>- x\n</code></pre>\n  </li>\n</ol>',
    )
    expect(carveToHtml('- - ```\n    - x\n    ```\n').trim()).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>- x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('keeps the residual columns of an over-indented marker as code text', () => {
    expect(carveToHtml('- ```\n    - x\n  ```\n').trim()).toBe(item('  - x'))
  })

  it('applies to the flush-left block a `+` first-block item attaches', () => {
    // Control: the same document with plain body text. The two must agree, for
    // the reason the 276 row and the 278 row must.
    expect(carveToHtml('- +\n```\nx\n```\n').trim()).toBe(item('x'))
    expect(carveToHtml('- +\n```\n- x\n```\n').trim()).toBe(item('- x'))
  })

  it('applies to the flush-left block a mid-item `+` attaches', () => {
    expect(carveToHtml('- a\n+\n```\nx\n```\n').trim()).toBe(
      '<ul>\n  <li>a\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>',
    )
    expect(carveToHtml('- a\n+\n```\n- x\n```\n').trim()).toBe(
      '<ul>\n  <li>a\n    <pre><code>- x\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('CONTROL: a marker AFTER the fence closes still opens a sub-list', () => {
    // The guard is on the OPEN fence, so closing it must restore the marker.
    // A guard written as "the item opened a fence anywhere" passes every case
    // above and fails this one.
    expect(carveToHtml('- ```\n  y\n  ```\n  - x\n').trim()).toBe(
      '<ul>\n  <li>\n    <pre><code>y\n</code></pre>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('CONTROL: a marker with no fence above it still opens a sub-list', () => {
    expect(carveToHtml('- a\n  - x\n').trim()).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('survives fmt: the writer re-emits code text, not a sub-list', () => {
    for (const src of [
      '- ```\n  - x\n  ```\n',
      '- a\n\n  ```\n  - x\n  ```\n',
      '- +\n```\n- x\n```\n',
    ]) {
      const written = renderCarve(parse(src))
      expect(carveToHtml(written)).toBe(carveToHtml(src))
      expect(renderCarve(parse(written))).toBe(written)
    }
  })
})
