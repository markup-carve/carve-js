import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-W-125, case five: behind a text ^[ the leading caret of link text stays bare (carve-js#5201)', () => {
  it.each([
    ['x^[[^](/u)', 'x^[[^](/u)\n'],
    ['x^[[^]{.c}', 'x^[[^]{.c}\n'],
    ['x^[[\\^](/u)', 'x^[[^](/u)\n'],
  ])('writes %j as %j', (source, expected) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(format(source)).toBe(expected)
    expect(treesEqual(parse(expected), tree)).toBe(true)
  })

  it.each(['[\\^a](/u)', '[\\^a]{.c}', '[\\^a][]', '^[\\[[^[b]][x]'])('keeps the backslash the link needs in %j', (source) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree).source
    expect(treesEqual(parse(written), tree)).toBe(true)
    expect(written).toContain('[\\^')
    expect(format(written)).toBe(written)
  })
})
