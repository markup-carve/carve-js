import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

function checkWrites(source: string, expected: string): void {
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  expect(writeWithDiagnostics(parse(source)).source).toBe(expected)
  expect(format(expected)).toBe(expected)
}

describe('C2-W-088, C2-W-125: backslashes the escape procedure places (carve-js#5528)', () => {
  it.each([
    // Case five: the lone `[` of the note takes the backslash; the bracket pair `[b]` asks for nothing.
    ['a^[[b]\\[^]]', 'a^[[b]\\[^]]\n'],
    ['^a^[[b]\\[ ]]', '^a^[[b]\\[ ]]\n'],
    ['x ^[c [d]{\\[] f]] g', 'x ^[c [d]{\\[] f]] g\n'],
    // A list marker behind another marker takes its own escape; the last hyphen opens nothing.
    ['- - \\- -', '- - \\- -\n'],
    ['> - - \\- -', '> - - \\- -\n'],
  ])('writes %j as %j', checkWrites)
})

describe('C2-W-069: the form of an emphasis or strong (carve-js#5528)', () => {
  it.each([
    // A content star glued to the closer makes a run of two, so the strong is braced before the rounds (carve#6469).
    ['\\``c`* */}{*{//}{/ **}', '\\``c`* */}{*{//}{/ **}\n'],
    ['x */}{*. **}', 'x */}{*. **}\n'],
    // Behind a `{` the content star is a braced opener and makes no run: the bare form reads back.
    ['*{\\**^.|', '*{**^.|\n'],
    // A star between two word characters pairs with nothing, so it does not brace the strong around it.
    ['}*{/a/b a*b/}*}', '}*{/a/b a*b/}*}\n'],
    ['.*{/a*ba/b/}*{*z', '.*{/a*ba/b/}*{*z\n'],
  ])('writes %j as %j', checkWrites)
})
