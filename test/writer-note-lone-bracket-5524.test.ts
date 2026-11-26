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

describe('C2-I-089, C2-W-125: a caret pair in note content is an ordinary bracket (carve-js#5524)', () => {
  it.each([
    ['^[a \\[b\\]  \\[^\\[b\\]]', '^[a [b]  \\[^[b]]\n'],
    ['^[a [b]  \\[^[b]]', '^[a [b]  \\[^[b]]\n'],
    ['^[a \\[b\\]  \\[^[b]]', '^[a [b]  \\[^[b]]\n'],
    // No construct reads there, so the lone `[` gives no kind and the bracket pairs stay bare.
    ['^[ [b] [b] \\[^]', '^[ [b] [b] \\[^]\n'],
    ['x ^[c\\[^\\[[^]]', 'x ^[c\\[^\\[[^]]\n'],
    ['x ^[^\\[b\\]\\[^]', 'x ^[^[b]\\[^]\n'],
    ['^[^\\[b\\]\\[^\\[^]] [x]', '^[^[b]\\[^\\[^]] [x]\n'],
    // The bare parse reads a footnote reference, whose kind escapes every bracket (C2-W-088).
    ['^[[b]\\[^\\[]', '^[\\[b\\]\\[^\\[]\n'],
  ])('writes %j as %j', checkWrites)
})
