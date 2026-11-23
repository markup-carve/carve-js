import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// carve#6502, C2-B-154: a heading continuation stands past the heading's marker, also where the heading sits on the
// marker line of a body whose content column is left of that marker.
const UNCHANGED: string[] = [
  'Text.[^1]\n\n[^1]: = Head\n        cont\n',
  'Text.[^abcde]\n\n[^abcde]: === Head\n              cont\n              more\n',
  'Text.[^1]\n\n[^1]: Para.\n\n  == Head\n     cont\n',
  'Text.[^ab]\n\n[^ab]: == Head\\\n          cont\n',
  'Text.[^ab]\n\n[^ab]: == Head\n          cont\n          more\n',
  '- = Head\n    cont\n',
  ':: T\n: = Head\n    cont\n',
  '> = Head\n>   cont\n',
]

const MOVED: [string, string][] = [
  ['Text.[^1]\n\n[^1]: = Head\n       cont\n', 'Text.[^1]\n\n[^1]: = Head\n        cont\n'],
  ['Text.[^ab]\n\n[^ab]: == Head\n         cont\n\n  Tail.\n', 'Text.[^ab]\n\n[^ab]: == Head\n          cont\n\n  Tail.\n'],
]

describe('a heading continuation inside a body (carve#6502)', () => {
  it.each(UNCHANGED)('writes %j unchanged', (input) => {
    expect(format(input)).toBe(input)
  })

  it.each(MOVED)('writes %j as %j', (input, expected) => {
    const written = format(input)
    expect(written).toBe(expected)
    expect(treesEqual(parse(written), parse(input))).toBe(true)
    expect(format(written)).toBe(written)
  })
})
