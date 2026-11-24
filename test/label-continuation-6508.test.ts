import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

describe('C2-B-234, C2-W-154: a term takes no unindented line', () => {
  it('writes a typed-opener paragraph directly below a description list that ends in a term at column 0', () => {
    const source = ':: t\n---yaml\nk: v\n---\n'
    expect(format(source)).toBe(source)
    expect(treesEqual(parse(format(source)), parse(source))).toBe(true)
  })
})
