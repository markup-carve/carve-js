import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/**
 * A GFM delimiter row sets COLUMN alignment, and that lands on the header cells
 * only - the same tree the native `|=<` markers produce.
 *
 * It used to be propagated onto body cells as well, so the same logical table
 * parsed to two different trees depending on which separator syntax was used, and
 * the writer then serialized those propagated values as per-cell markers the
 * author never wrote (carve#352, corpus 09-tables-3).
 *
 * Nothing is lost: the HTML renderer inherits column alignment for a body cell
 * whose own align is unset, which is how the native path has always rendered
 * aligned body cells.
 */
const GFM = '| Name | Age |\n|:-----|----:|\n| Alice | 28  |\n'
const NATIVE = '|=< Name |=> Age |\n| Alice | 28 |\n'
const CANONICAL = '|=< Name |=> Age |\n| Alice | 28 |\n'

const alignsOf = (src: string): (string | undefined)[][] => {
  const table = parse(src).children.find((b) => b.type === 'table')
  if (table === undefined) throw new Error('no table')
  return table.rows.map((r) => r.cells.map((c) => c.align))
}

describe('a GFM delimiter row aligns the header, not every row', () => {
  it('leaves body cells unaligned in the tree', () => {
    expect(alignsOf(GFM)).toEqual([
      ['left', 'right'],
      [undefined, undefined],
    ])
  })

  it('parses to the same alignment tree as the native markers', () => {
    expect(alignsOf(GFM)).toEqual(alignsOf(NATIVE))
  })

  it('still renders body cells aligned, via column inheritance', () => {
    const html = carveToHtml(GFM)
    expect(html).toContain('<td style="text-align: left;">Alice</td>')
    expect(html).toContain('<td style="text-align: right;">28</td>')
  })

  it('does not invent per-cell markers when formatting', () => {
    expect(carveToCarve(GFM)).toBe(CANONICAL)
  })

  it('keeps a genuine per-cell override', () => {
    // The header says right; one body cell overrides to left. That marker is not
    // redundant and must survive.
    const src = '|= Item |=> Qty |\n| Apple | 12 |\n| Subtotal |< 12 |\n'
    expect(carveToCarve(src)).toBe('|= Item |=> Qty |\n| Apple | 12 |\n| Subtotal |< 12 |\n')
  })
})
