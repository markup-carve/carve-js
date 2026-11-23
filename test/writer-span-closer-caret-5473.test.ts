import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-W-011, C2-W-125: a span holding ][^ is written with the backslash of its closer alone (#5473)', () => {
  it.each([
    ['> ![\\][^]{.c}[^]](u)', '> ![\\][^]{.c}[^]](u)\n'],
    ['- ![\\][^]{.c}\\]][^k]', '- ![\\][^]{.c}]][^k]\n'],
    ['x [\\][^]{.c} y', 'x [\\][^]{.c} y\n'],
    ['x ![\\][^]{.c} y', 'x ![\\][^]{.c} y\n'],
  ])('writes %j as %j', (source, expected) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(treesEqual(parse(expected), tree)).toBe(true)
    expect(format(source)).toBe(expected)
    expect(format(expected)).toBe(expected)
  })
})
