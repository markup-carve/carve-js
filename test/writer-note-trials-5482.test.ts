import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-W-125: the trials of a note are tested again once the closer escapes behind them are placed (#5482)', () => {
  it.each([
    ['^[ [^[b][[^b]\\[]]', '^[ \\[^[b][[^b]\\[\\]]\n'],
    ['^[^[^[b][^b][[^b]\\[]]', '^[^\\[^\\[b\\][^b][[^b]\\[\\]]\n'],
    ['^[\\[^[a\\^[b][[b]\\]]', '^\\[\\[^[a^[b][[b]\\]]\n'],
    ['^[[[^[b][^b][[^b]]\\[]]', '^[\\[\\[^\\[b\\][^b][[^b]\\]\\[\\]]\n'],
  ])('writes the tree of %j with no loss', (source, canonical) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(canonical)
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    expect(format(source)).toBe(canonical)
    expect(format(canonical)).toBe(canonical)
  })
})

describe('C2-I-089, C2-W-125: a leading caret of link text in a note that did not form takes the backslash (#5482)', () => {
  it.each([
    ['^[^[[\\^b][[b]\\]]', '^\\[^[[^b][[b]\\]]\n'],
    ['^[^[[\\^ b][[b]\\]]', '^\\[^[[^ b][[b]\\]]\n'],
  ])('writes the tree of %j with no loss', (source, canonical) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(canonical)
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    expect(format(canonical)).toBe(canonical)
  })
})
