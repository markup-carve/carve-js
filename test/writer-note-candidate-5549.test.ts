import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

describe('C2-I-089: text note candidates with inner brackets', () => {
  it('keeps a demoted candidate bare when it already reads back', () => {
    const source = 'x ^[[^ [^a]]\n'
    expect(format(source)).toBe(source)
    expect(treesEqual(parse(format(source)), parse(source))).toBe(true)
  })
})
