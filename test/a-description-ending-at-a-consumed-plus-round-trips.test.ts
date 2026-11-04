/*
 * PART 12 §6: a description that ends at a consumed `+` (CARVE-P12-020) keeps
 * that end through fromAstJson, so the wire round trip is the identity.
 */
import { describe, it, expect } from 'vitest'
import { fromAstJson, parse, toAstJson } from '../src/index.js'

describe('a description ending at a consumed plus', () => {
  it.each([
    ':: t\n: a\n+\n{x}\n: b\n',
    ':: t\n: a\n+\n',
  ])('round-trips its span: %j', (source) => {
    const wire = toAstJson(parse(source))
    expect(toAstJson(fromAstJson(JSON.parse(JSON.stringify(wire))))).toEqual(wire)
  })

  it('still ends at its content when the wire says so', () => {
    const wire = toAstJson(parse(':: t\n: a\n'))
    expect(toAstJson(fromAstJson(JSON.parse(JSON.stringify(wire))))).toEqual(wire)
  })
})
