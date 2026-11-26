import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-211 C2-B-212, U-150: a short parsed table column list', () => {
  it('cites the map row and the table metadata source range', () => {
    const source = '{valigns=top,bottom widths=40}\n| a | b | c |\n'
    const result = upgrade(source)
    expect(result.check).toBe('explained')
    expect(result.records).toContainEqual(expect.objectContaining({
      entry: 'U-150', range: { startOffset: 0, endOffset: 30 },
    }))
  })

  it.each([
    '```\n{valigns=top,bottom widths=40}\n| a | b | c |\n```',
    '%%%\n{valigns=top,bottom widths=40}\n| a | b | c |\n%%%',
    '{widths=40,30,30}\n| a | b | c |\n',
  ])('leaves near misses without a U-150 report: %s', (source) => {
    expect(upgrade(source).records.map((record) => record.entry)).not.toContain('U-150')
  })
})
