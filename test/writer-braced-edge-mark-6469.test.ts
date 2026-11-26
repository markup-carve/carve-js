import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// carve#6469, C2-W-069: a content mark glued to the closer or the opener could pair, so the node takes its braced
// form, whatever stands behind it.
const CASES: [string, string][] = [
  ['*]\\**^*|\n', '{*]**}^*|\n'],
  ['*a\\**^*|\n', '{*a**}^*|\n'],
  ['/]\\//^/|\n', '{/]//}^/|\n'],
  ['x *a\\** y*\n', 'x {*a**} y*\n'],
  ['*]\\**\n', '{*]**}\n'],
  ['x *\\**\n', 'x {***}\n'],
  ['x *\\*a* y*\n', 'x {**a*} y*\n'],
]

describe('a paired node whose content mark is glued to its own mark (carve#6469)', () => {
  it.each(CASES)('writes %j as %j', (input, expected) => {
    const written = format(input)
    expect(written).toBe(expected)
    expect(treesEqual(parse(written), parse(input))).toBe(true)
    expect(format(written)).toBe(written)
  })
})
