import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function checkWrites(source: string, expected: string): void {
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  expect(writeWithDiagnostics(parse(source)).source).toBe(expected)
  expect(writeTreeWithStats(parse(source), undefined, 'plan').output.source).toBe(expected)
  expect(writeTreeWithStats(parse(source), undefined, 'repair').output.source).toBe(expected)
  expect(format(expected)).toBe(expected)
}

// carve-js#5464, C2-W-088: a round whose parse holds a construct the tree does not hold escapes that construct's opener
// and its kind. The escape of a closer the construct can cause, or of a closing mark in the text behind a node, waits
// for the next parse, which no longer asks for it. C2-W-069: a brace before a pair that the text behind it braces opens
// nothing more.
describe('C2-W-088: closer repairs wait for the parse after a reported construct (carve-js#5464)', () => {
  it.each([
    [',{,,{\\,,^},},}', ',{,,\\{,,^},},}\n'],
    ['{x{^^{\\^^^^}^}', '{x{^^\\{^^^^}^}\n'],
    ['> ,}{{*,}\\{x*}*', '> ,}{{*,}{x*}*\n'],
    ['- [,{,{\\,]},,},}', '- [,{,\\{,]},,},}\n'],
    ['- {^^^{\\^/}^^}^}', '- {^^^\\{^/}^^}^}\n'],
    ['a a,]{,,{\\,,,,},}', 'a a,]{,,\\{,,,,},}\n'],
    ['> - {{,,^}\\{,},,},}', '> - {{,,^}\\{,},,},}\n'],
    ['- {_}},{,,\\{,},,},}', '- {_}},{,,\\{,},,},}\n'],
    ['a {,{,,{\\,\\,,},,},}', 'a {,{,,\\{,,,},,},}\n'],
    ['> {/{,,\\{,},,},}', '> {/{,,\\{,},,},}\n'],
  ])('writes %j as %j', checkWrites)
})
