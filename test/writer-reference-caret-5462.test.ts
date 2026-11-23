import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-W-091, C2-W-125: the leading caret of a reference whose key is its content (carve-js#5462)', () => {
  it('writes the reproduction as itself, with no loss report', () => {
    const source = '^[[^^^^[^[b]][]'
    const written = writeWithDiagnostics(parse(source))
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(`${source}\n`)
    expect(format(written.source)).toBe(written.source)
  })

  it.each([
    '^[[^[b]][]', '^[[^^[b]][] c', '^[\\[[^[b]][]', '^[\\[[^][]', '^[\\[[^[b]][x]', '^[\\[[^b][]]', 'x [\\^b][]',
  ])('keeps the tree of %j through write and format', (source) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    const formatted = format(source)
    expect(treesEqual(parse(formatted), tree)).toBe(true)
    expect(format(written.source)).toBe(written.source)
  })
})
