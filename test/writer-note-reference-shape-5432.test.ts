import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

describe('C2-I-089, C2-W-088: a reference shape in a note that holds a written backslash (carve-js#5432)', () => {
  it('escapes the bracket of the shape, so the text reads with its escapes', () => {
    const source = '^[[[^\\}[]]]\n'
    const written = format(source)
    expect(written).toBe('^[\\[\\[^\\\\\\}\\[\\]\\]]\n')
    expect(treesEqual(parse(written), parse(source))).toBe(true)
    expect(format(written)).toBe(written)
  })

  it.each([
    '^[[^\\*[]]', '^[[^\\}[]]', '^[a[^b\\_[]]', '^[[^a[^\\*]]', 'a ^[b [^\\*[] c]', '^[[^\\}[]] ^[[^\\}[]]',
  ])('writes %j with no loss report', (source) => {
    const out = writeWithDiagnostics(parse(source))
    expect(out.diagnostics).toEqual([])
    expect(treesEqual(parse(out.source), parse(source))).toBe(true)
    expect(format(out.source)).toBe(out.source)
  })
})
