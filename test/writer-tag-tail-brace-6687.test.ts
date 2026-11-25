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

// carve#6687, C2-W-125: a node of the tree behind the brace changes nothing. Case six gives the tree alone, so neither
// brace takes a backslash (C2-W-088 calls one a defect).
describe('C2-W-125: a brace around a tag tail stays bare beside another node (carve#6687)', () => {
  it.each([
    ['x{#a\\_--} *s*', 'x{#a\\_--} *s*\n'],
    ['x{#a\\_--} [l](u)', 'x{#a\\_--} [l](u)\n'],
    ['x{#a\\_---} "q"', 'x{#a\\_---} "q"\n'],
    ['x{#a\\_--} `c`', 'x{#a\\_--} `c`\n'],
    ['x{#a\\_--} /e/', 'x{#a\\_--} /e/\n'],
    ['{#ab\\_---}x [l](u)', '{#ab\\_---}x [l](u)\n'],
    ['a x{@a\\_--} *s*', 'a x{@a\\_--} *s*\n'],
    ['x{#a\\-w}', 'x{#a\\-w}\n'],
    ['x{#a\\-w} *s*', 'x{#a\\-w} *s*\n'],
    ['x{#a\\--w}', 'x{#a\\--w}\n'],
    ['x {#a1\\-w}x /e/', 'x {#a1\\-w}x /e/\n'],
    [`x{#${'a'.repeat(80)}\\-w} *s*`, `x{#${'a'.repeat(80)}\\-w} *s*\n`],
  ])('writes %j as %j', checkWrites)

  // A `\-` of a hyphen run is a kind of a later round, which keeps the brace backslash of the earlier one (C2-W-091).
  it.each([
    ['x{#a\\---}', 'x\\{#a\\---}\n'],
    ['x{#a\\----} *s*', 'x\\{#a\\----} *s*\n'],
    ['x{#a\\--}x', 'x\\{#a-\\-}x\n'],
  ])('keeps the brace backslash of %j', checkWrites)
})

// C2-W-125, C2-W-091: where another construct of the paragraph takes a backslash, the brace keeps its own.
describe('C2-W-125: the brace keeps its backslash beside another escaped construct (carve#6687)', () => {
  it.each([
    ['x{#a\\-w\\---}', 'x\\{#a\\-w\\---}\n'],
    ['x{#a\\-w} \\*s*', 'x\\{#a\\-w} \\*s*\n'],
    ['x{#a\\-w} \\[l](u)', 'x\\{#a\\-w} \\[l](u)\n'],
    ['\\--- x{#a\\-w}', '\\--- x\\{#a\\-w}\n'],
    ['x{#a\\-w} y{#b\\-w}', 'x\\{#a\\-w} y\\{#b\\-w}\n'],
    ['x{@a\\-w} y{#b\\-w}', 'x{@a\\-w} y\\{#b\\-w}\n'],
  ])('writes %j as %j', checkWrites)

  // A backslash before a letter is text, not an escape, and a code span or a destination holds its backslashes as
  // they are. A name can hold `-` and `_`.
  it.each([
    ['x{#a\\-w} c\\\\d', 'x{#a\\-w} c\\d\n'],
    ['x{#a\\-w} `\\*`', 'x{#a\\-w} `\\*`\n'],
    ['x{#a\\-w} [u](/a\\*b)', 'x{#a\\-w} [u](/a\\*b)\n'],
    ['x{#ab-c\\-w} *s*', 'x{#ab-c\\-w} *s*\n'],
    ['x{#ab_c\\-w}', 'x{#ab_c\\-w}\n'],
  ])('prunes the brace of %j', checkWrites)
})
