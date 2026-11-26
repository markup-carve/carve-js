import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-W-125: a caret that only an escaped closer behind it needs keeps its backslash (#5468)', () => {
  it.each([
    ['^[a\\^[b][[b]\\]]', '^[a^[b][[b]\\]]\n'],
    ['^[\\^[b][[b]\\]]', '^[^[b][[b]\\]]\n'],
    ['x ^[ \\^[b][[^b]\\]] [x]', 'x ^[ ^[b][[^b]\\]] [x\\]\n'],
    ['^[^[a\\^[b][[b]\\]]', '^\\[^[a^[b][[b]\\]]\n'],
    ['^[a\\^[b][[b]\\][b]]', '^[a^[b][[b]\\]\\[b\\]]\n'],
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

describe('C2-W-091: a tree from a parse that every earlier form lost (#5468)', () => {
  it('writes the former unspellable example of the property suite', () => {
    const source = 'x{/^[/}@\\`\\]\\`"\''
    const written = writeWithDiagnostics(parse(source))
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe('x{/^\\[/}@\\`]\\`"\'\n')
    expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  })
})

describe('the writer keeps its form where it already read back (#5468)', () => {
  it('writes a note that closes with the bracket behind it as before', () => {
    expect(format('^[a\\^[b][[b]\\]]]')).toBe('^[a^[b][[b]\\]]\\]\n')
  })
})
