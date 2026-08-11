import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, toAstJson } from '../src/index.js'

const topTypes = (source: string): string[] =>
  ((toAstJson(parse(source)).children ?? []) as Array<{ type: string }>).map((c) => c.type)

/**
 * Two adjacent sibling lists written at the same column with matching markers
 * merge on re-parse, so `parse(fmt(x)) == parse(x)` is false for a document the
 * parser reads as two lists (carve#1088).
 *
 * carve#286 spent the marker axis - emit the marker as authored - which
 * separates them only while the markers DIFFER. When both are `1.` at column 0
 * there is nothing left to preserve, and indentation is the only axis left.
 *
 * One space is the only offset safe for both list kinds: a bullet's content
 * column is 2, so two spaces already nests. The step is cumulative per list,
 * because writing every later list at +1 leaves the second and third at the
 * same column, merging with each other.
 */
describe('adjacent sibling lists stay separate through fmt', () => {
  it('separates two ordered lists with one space', () => {
    const source = '1. a\n\n  1. b\n'
    expect(topTypes(source)).toEqual(['list', 'list'])
    expect(carveToCarve(source)).toBe('1. a\n\n 1. b\n')
    expect(topTypes(carveToCarve(source))).toEqual(['list', 'list'])
  })

  it('steps each further list by one more space', () => {
    const source = '1. a\n\n  1. b\n\n   1. c\n'
    expect(topTypes(source)).toEqual(['list', 'list', 'list'])
    expect(carveToCarve(source)).toBe('1. a\n\n 1. b\n\n  1. c\n')
    expect(topTypes(carveToCarve(source))).toEqual(['list', 'list', 'list'])
  })

  it('is idempotent across repeated passes', () => {
    const once = carveToCarve('1. a\n\n  1. b\n\n   1. c\n')
    expect(carveToCarve(once)).toBe(once)
    expect(carveToCarve(carveToCarve(once))).toBe(once)
  })

  it('keeps the HTML unchanged', () => {
    const source = '1. a\n\n  1. b\n'
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  /**
   * BOUND, not proof: when the markers already differ the lists separate on
   * their own (carve#286), so no space is owed and none is added. Removing the
   * offset entirely leaves this passing - it is here so a fix cannot pass by
   * indenting every list that follows another one.
   */
  it('adds nothing when the bullet character already separates them', () => {
    const source = '- a\n\n * b\n'
    expect(topTypes(source)).toEqual(['list', 'list'])
    expect(carveToCarve(source)).toBe('- a\n\n* b\n')
    expect(topTypes(carveToCarve(source))).toEqual(['list', 'list'])
  })

  /**
   * BOUND: one list, and two lists with a paragraph between them, are both
   * untouched. Neither breaks under any mutation of the offset.
   */
  it('leaves a single list and a separated pair alone', () => {
    expect(carveToCarve('1. a\n1. b\n')).toBe('1. a\n2. b\n')
    expect(carveToCarve('1. a\n\nx\n\n1. b\n')).toBe('1. a\n\nx\n\n1. b\n')
  })
})
