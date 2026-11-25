import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

// C2-W-088 (carve#6681): of a run of text `[`, a round escapes the first bracket and the reported openers. Another
// bracket of the run takes a backslash only where a later round reports it.
describe('C2-W-088: the backslashes on a run of text brackets', () => {
  it.each([
    // A reference: the escaped bracket changes the label, so the next bracket forms nothing.
    ['\\[\\[\\[x\\]\n\n[x]: /u\n', '\\[[\\[x]\n\n[x]: /u\n'],
    ['\\[\\[\\[x\\]\\[\\]\n\n[x]: /u\n', '\\[[\\[x]\\[]\n\n[x]: /u\n'],
    ['\\[\\[\\[a\\]\\[x\\]\n\n[x]: /u\n', '\\[[\\[a]\\[x]\n\n[x]: /u\n'],
    ['\\[\\[x\\]\n\n[x]: /u\n', '\\[\\[x]\n\n[x]: /u\n'],
    // C2-W-125 case five, carve#6656 ruling A: the case backslash stands beside the kind escapes of the same round.
    ['\\[\\[x\\[a [b\\] c](u)\n', '\\[[x\\[a [b\\] c](u)\n'],
    ['\\[\\[x\\[a [b\\] c](u)\n\n[x]: /u\n', '\\[[x\\[a [b\\] c](u)\n\n[x]: /u\n'],
    ['\\[\\[\\[x [b\\] c](u)\n\n[x]: /u\n', '\\[[\\[x [b\\] c](u)\n\n[x]: /u\n'],
    ['\\[\\[\\[\\[x\\] [b\\] c](u)\n', '\\[[\\[[x] [b\\] c](u)\n'],
    // The content holds a `]` that pairs with a bracket the round escapes, and the freed `]` takes the next bracket.
    ['\\[\\[\\[x \\[b\\] c\\](u)\n', '\\[[\\[x \\[b] c](u)\n'],
    // An inline link: each round reports the next bracket, so every bracket of the run takes one.
    ['\\[\\[\\[x\\](u)\n', '\\[\\[\\[x](u)\n'],
  ])('writes %j as %j', (source, expected) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(format(expected)).toBe(expected)
    expect(treesEqual(parse(expected), tree)).toBe(true)
  })
})
