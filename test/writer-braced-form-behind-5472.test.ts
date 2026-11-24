import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function checkWrites(source: string, expected: string): void {
  const tree = parse(source)
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), tree)).toBe(true)
  expect(writeWithDiagnostics(tree).source).toBe(expected)
  expect(writeTreeWithStats(tree, undefined, 'plan').output.source).toBe(expected)
  expect(writeTreeWithStats(tree, undefined, 'repair').output.source).toBe(expected)
  expect(format(expected)).toBe(expected)
}

// carve-js#5472, C2-W-069, C2-W-125 case one, C2-W-010: a pair behind a braced pair keeps no braced form a repair
// round gave it while the pair before still read on over it; the plan and the repair write the same bytes.
describe('C2-W-010: a pair behind a braced pair is written the same on every path (carve-js#5472)', () => {
  it.each([
    ['{*{  *} {{*{x*}\n', '{*{  *} \\{*{x*\n'],
    ['{*{  *}{{*x}*}\n', '{*{  *}\\{*x}*\n'],
    ['1. {{*x *} {{*{x*}\n', '. {{*x *} \\{*{x*\n'],
    ['> {*{ *} {{*x}*}{{/{*/a /x /\n', '> {*{ *} \\{*x}*{{/{*/a /x /\n'],
    ['> - {*{  *}{{*x*}\n', '> - {*{  *}\\{*x*\n'],
  ])('writes %j as %j', checkWrites)
})
