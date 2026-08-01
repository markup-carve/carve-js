import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'

/**
 * A `+` continuation row extends a cell onto later lines. The cell's span used
 * to be DELETED when that happened, which cost three nodes a position at once -
 * the cell, the row that spans its cells, and the text inside (carve-js#462).
 *
 * Deleting it was the right instinct applied to the wrong shape: the gap is
 * inside a CELL, not between rows. The cell itself runs contiguously from its
 * first character to its last, so a span exists.
 */
const source = `|= Feature |= Description        |
| Complex  | A long description |
+          | that continues     |
+          | across lines.      |
| Simple   | Single line.       |
`

const slice = (pos: { startOffset: number; endOffset: number }): string =>
  [...source].slice(pos.startOffset, pos.endOffset).join('')

const table = (): any => parse(source).children[0] as any

describe('positions across a table continuation', () => {
  it('does NOT place the continued cell, because it is not one range', () => {
    // The cell's content sits in two column ranges on non-adjacent lines. One
    // range covering both would swallow the neighbouring column's content on
    // the lines between - cell 1 would CONTAIN cell 0, and an offset would map
    // to two sibling cells at once.
    //
    // This was tried the other way first: extending the cell's span to its last
    // line makes every node in the corpus placeable and quietly breaks the
    // property that sibling spans do not overlap.
    const row = table().rows[1]

    expect(row.cells[1].pos).toBeUndefined()
    expect(row.cells[0].pos, 'a cell that does not continue keeps its span').toBeDefined()
  })

  it('places the row anyway, because a row IS one range', () => {
    const row = table().rows[1]

    expect(row.pos, 'the row carries a position').toBeDefined()
    expect(row.pos.startLine).toBe(2)
    expect(row.pos.endLine).toBe(4)
  })

  it('leaves a single-line row untouched', () => {
    const row = table().rows[2]

    expect(row.pos.startLine).toBe(5)
    expect(row.pos.endLine).toBe(5)
    expect(slice(row.cells[1].pos)).toBe(' Single line.       ')
  })

  it('does NOT place the joined text, because no span selects it', () => {
    // The text is assembled from three lines that are not adjacent in the
    // source. Any span covering it would include the `+ … |` structure between
    // them - and a text node's span must select its own text, so the honest
    // answer is none. PART 12 section 4 forbids inventing a position; it does
    // not require inventing one here.
    const text = table().rows[1].cells[1].children[0]

    expect(text.type).toBe('text')
    expect(text.value).toBe('A long description that continues across lines.')
    expect(text.pos).toBeUndefined()
  })

  it('places the text of a cell that does NOT continue', () => {
    const text = table().rows[2].cells[1].children[0]

    expect(text.pos, 'an ordinary cell still anchors its content').toBeDefined()
    expect(slice(text.pos)).toBe(text.value)
  })
})
