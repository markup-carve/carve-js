import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

describe('C2-W-125: repair a lone content bracket before trying a brace (#5555)', () => {
  it.each(['^[a{^\\[]]\n', '^[{^\\[]]\n'])('writes %j without an unneeded brace escape', (source) => {
    expect(format(source)).toBe(source)
    expect(treesEqual(parse(format(source)), parse(source))).toBe(true)
  })
})
