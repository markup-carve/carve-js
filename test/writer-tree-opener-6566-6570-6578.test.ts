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

// carve#6566, C2-W-088: a span the bare parse reads on the opener of a node of the tree is that node, also where it
// reads on or ends early; C2-W-125 repairs it and no kind is reported.
describe('C2-W-088: a span on the tree\'s own opener reports no kind (carve#6566)', () => {
  it.each([
    ['\\^^},} {,\\{,,}\\},}\\,{,', '^^},} {,\\{,,}},},{,\n'],
    ['- {^\\}^{a^\\}{^^}^},,,}', '- {^}^{a\\^}{^^}^},,,}\n'],
    ['- {^^}\\{\\},,{,\\^\\{,},}}}{,,}^{,,},}', '- {^^}{},,{,^\\{,},}}}{,,}^{,,},}\n'],
    ['> {,\\{,,}\\},}\\,{,', '> {,\\{,,}},},{,\n'],
  ])('writes %j as %j', checkWrites)
})
