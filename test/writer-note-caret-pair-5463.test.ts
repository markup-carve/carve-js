import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-W-002, C2-W-003: a caret pair in a note is left to the repair (carve-js#5463)', () => {
  it('formats the canonical form of the reproduction to itself', () => {
    const canonical = '^[^^[b][[^[b]\\a]\n'
    expect(writeWithDiagnostics(parse('^[^\\^[b][[^[b]\\a]')).source).toBe(canonical)
    expect(format(canonical)).toBe(canonical)
    expect(format('^[^\\^[b][[^[b]\\a]')).toBe(canonical)
  })

  it.each([
    '^[a\\^[b][[^[b]]', '^[\\^[b][[^b]]', '^[ \\^[b][[b][]]', '^[^\\^[b][\\^[b]\\a]', 'x ^[a\\^[b][[^\\[b]^]',
    '^[\\^\\^[b][[b] c] [x]',
  ])('keeps the tree of %j through format and write', (source) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    const formatted = format(source)
    expect(formatted).toBe(written.source)
    expect(format(formatted)).toBe(formatted)
  })

  it('leaves a caret pair bare where the note holds it as text', () => {
    expect(format('^[a\\^[b]]')).toBe('^[a^[b]]\n')
    expect(format('^[^\\^[b][x]]')).toBe('^[^^[b][x]]\n')
  })
})
