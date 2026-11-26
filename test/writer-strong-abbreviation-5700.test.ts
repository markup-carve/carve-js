import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

// C2-B-084, C2-W-005 (carve-js#5700): a strong that opens the first line is written with `*`, so a bracket label behind
// it would open an abbreviation definition; the bracket keeps its backslash.
describe('C2-W-005: the bracket behind the star of a strong at a line start', () => {
  it.each([
    ['*\\[x]: ^*\n', '*\\[x]: ^*\n'],
    ['*\\[1]: y*\n', '*\\[1]: y*\n'],
    ['*\\[x]: `c`*\n', '*\\[x]: `c`*\n'],
    ['a\n\n*\\[x]: y*\n\nb\n', 'a\n\n*\\[x]: y*\n\nb\n'],
    // No abbreviation shape: the bracket needs no backslash.
    ['*\\[x]*\n', '*[x]*\n'],
    ['*\\[x y]: z*\n', '*[x y]: z*\n'],
  ])('writes %j as %j', (source, expected) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(format(expected)).toBe(expected)
    expect(treesEqual(parse(expected), tree)).toBe(true)
  })

  // C2-W-088: a bare bracket of a later line sends the group to the kind rounds, which may pick another spelling.
  it.each(['*\\[x]: ^*\n[\n', '*\\[x]: ^* q\n[a\n'])('reads %j back', (source) => {
    const written = format(source)
    expect(treesEqual(parse(written), parse(source))).toBe(true)
    expect(format(written)).toBe(written)
  })
})
