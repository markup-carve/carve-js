import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `CARVE-P9-031` places the continuation marker at its container's MARKER
 * COLUMN and nowhere else. Under `- x` / `  > q` those columns are 0 and 2, so
 * a `+` at column 1 names no container and falls through to the quote's lazy
 * fold as ordinary text.
 *
 * This engine already answered every column this way. carve-php and carve-rs
 * consumed the column-1 marker instead, because the quote's body arrives
 * stripped of the item's indentation and their column test read the stripped
 * view (markup-carve/carve-php#2470). These rows are the oracle those two are
 * now measured against, so they are pinned here.
 */
const markerAt = (column: number) => carveToHtml(`- x\n  > q\n${' '.repeat(column)}+\n`)

const consumed = '<ul>\n  <li>x\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>'
const kept = '<ul>\n  <li>x\n    <blockquote><p>q\n+</p></blockquote>\n  </li>\n</ul>'

describe("a marker left of a quote's column is text", () => {
  it('consumes the marker at either container column', () => {
    expect(markerAt(0)).toBe(consumed)
    expect(markerAt(2)).toBe(consumed)
  })

  it('keeps a marker at a column naming no container', () => {
    expect(markerAt(1)).toBe(kept)
  })

  it('keeps a marker inside the quote content', () => {
    expect(markerAt(3)).toBe(kept)
    expect(markerAt(4)).toBe(kept)
  })

  it("still attaches a block at a top-level quote's own column", () => {
    expect(carveToHtml('> q\n+\n- m\n')).toBe(
      '<blockquote>\n  <p>q</p>\n  <ul>\n    <li>m</li>\n  </ul>\n</blockquote>',
    )
  })
})
