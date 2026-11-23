import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-W-125, case eight: a text ^[ stays bare and the ] that closed it early takes the backslash (carve#6471)', () => {
  it.each([
    ['^[ \\]} [^[b]\\]][]'],
    ['x ^[a \\] b \\] [^[b] c][] z'],
    ['- ^[ [x] \\]} [^a[b]][].'],
    ['> ^[ *s* \\] [^[b] c][]'],
    ['x ^[q `c` \\], [^a[b]][]'],
    ['x ^[ [x] \\] [^[[b]]][].'],
  ])('writes the tree of %j back as it was written', (source) => {
    const canonical = `${source}\n`
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(canonical)
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    expect(format(canonical)).toBe(canonical)
  })
})
