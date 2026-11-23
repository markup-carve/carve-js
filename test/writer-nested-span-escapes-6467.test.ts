import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'
import { referenceForm } from './support/writer-checks.ts'

function expectWritten(source: string, expected: string): void {
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  expect(referenceForm(written.source, parse(source))).toEqual({ form: expected })
}

describe('C2-W-088, C2-W-125: a nested span takes only the escapes the procedure places (carve#6467)', () => {
  it.each([
    ['{,{,,\\{,},,},}\n', '{,{,,\\{,},,},}\n'],
    ['- {,{,,{\\,,},,},}\n', '- {,{,,\\{,,},,},}\n'],
    ['> {,{,,{\\,,},,},}\n', '> {,{,,\\{,,},,},}\n'],
    ['{,{,,{\\,,},,},}\n', '{,{,,\\{,,},,},}\n'],
    ['{^{^^{\\^^}^^}^}\n', '{^{^^\\{^^}^^}^}\n'],
    // The brace of case one reads as an opener; a brace behind a space opens nothing, so the closer takes the backslash.
    ['{*{ **} x*}\n', '*{ \\** x*}\n'],
  ])('writes %j as %j', expectWritten)
})

describe('C2-W-069, C2-W-011: a strong whose closer cannot close in place takes the braced form (carve#6468)', () => {
  it.each([
    ['- {*{ *} {{x]*}\n', '- {*{ *} {{x]*}\n'],
    ['{*{ *} x*}\n', '{*{ *} x*}\n'],
    ['> {*{ *} {{x]*}\n', '> {*{ *} {{x]*}\n'],
    ['{/{ /} x/}\n', '{/{ /} x/}\n'],
    ['a {*{ *} {x]*}\n', 'a {*{ *} {x]*}\n'],
  ])('writes %j as %j', expectWritten)
})
