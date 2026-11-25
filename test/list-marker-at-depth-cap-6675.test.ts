import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.ts'

/** The number of list items in the tree of `source`. */
function items(source: string): number {
  return (JSON.stringify(parse(source)).match(/"type":"list_item"/g) ?? []).length
}

describe('carve#6675: an unprefixed list marker below a paragraph at block depth 200', () => {
  it('C2-B-190, C2-B-228 (carve#6610): every open block counts, so the marker is text of a lazy line', () => {
    const source = `. ${'> - '.repeat(66)}x\n   - y\n`
    expect(items(source)).toBe(67)
    expect(JSON.stringify(parse(source))).toContain('"value":"- y"')
  })

  it('C2-B-190: with room for a list and its item the marker still opens them', () => {
    expect(items(`. ${'> - '.repeat(65)}x\n   - y\n`)).toBe(67)
  })

  it('C2-B-190: a sibling item needs one level, and none is free at 200 open blocks', () => {
    expect(items(`${'- '.repeat(100)}x\n- y\n`)).toBe(100)
    expect(items(`${'- '.repeat(99)}x\n- y\n`)).toBe(100)
  })
})
