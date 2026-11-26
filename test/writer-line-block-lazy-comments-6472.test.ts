import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-B-024, C2-W-002: every trailing lazy %% line of a line block line is written below it (carve#6472)', () => {
  it('writes the reproduction with both comments at column 0', () => {
    const source = '- ::: |\n  a\n%% x\n%% y'
    const expected = '- ::: |\n  a\n%% x\n%% y\n  :::\n'
    const written = writeWithDiagnostics(parse(source))
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(formatWithDiagnostics(source).source).toBe(expected)
    expect(format(expected)).toBe(expected)
  })

  it.each([
    '- ::: |\n  a\n%% x\n%% y\n%% w',
    '- ::: |\n  a\n%% x\n%% y\n  b\n%% z',
    '> ::: |\n> a\n%% x\n%% y',
    '- - ::: |\n    a\n%% x\n%% y\n    b',
  ])('keeps the tree of %j', (source) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    expect(format(written.source)).toBe(written.source)
  })
})
