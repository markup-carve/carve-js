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

// carve#6570, C2-W-125 case nine: the bare form of the underline reads as an attribute block (C2-I-043), so the first
// character of its content that the block holds takes the backslash.
describe('C2-W-125, case nine: an underline that reads as an attribute block (carve#6570)', () => {
  it.each([
    ['{_=\\._}', '{_\\=._}\n'],
    ['{_=\\!_}', '{_\\=!_}\n'],
    ['x{_=\\._}y', 'x{_\\=._}y\n'],
    ['> a {_=\\._} b', '> a {_\\=._} b\n'],
    ['- {_=\\._}', '- {_\\=._}\n'],
    ['| {_=\\._} |', '| {_\\=._} |\n'],
    // The `=` behind the key characters makes the block valid, so it takes the backslash, not a hyphen before it.
    ['{_foo-bar=\\._}', '{_foo-bar\\=._}\n'],
    ['{_a\\=b_}', '{_a\\=b_}\n'],
  ])('writes %j as %j', checkWrites)
})

// carve#6578, C2-W-125: the brace before the tag forms the dash behind it, so the closing brace takes no backslash;
// case six escapes the underscore behind the tag.
describe('C2-W-125: a closing brace behind a tag, an underscore and a dash stays bare (carve#6578)', () => {
  it.each([
    ['x{#a\\_--}', 'x{#a\\_--}\n'],
    ['_{#a\\_--}', '_{#a\\_--}\n'],
    ['> x{#a\\_--}', '> x{#a\\_--}\n'],
  ])('writes %j as %j', checkWrites)
})
