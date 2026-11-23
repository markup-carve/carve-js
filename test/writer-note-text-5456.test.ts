import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

const cases: [string, string][] = [
  // #5456: once the note closes in place, nothing opens on the text `]` behind it.
  ['x ^[\\[]]\n', 'x ^[\\[]]\n'],
  ['x ^[\\]{/\\[]]**\n', 'x ^[\\]{/\\[]]**\n'],
  ['- ^[{*[l]\\[]]\n', '- ^[{*\\[l\\]\\[]]\n'],
  ['x {^^[/}\\]/} ]\\]\n', 'x {^^[/}\\]/} ]]\n'],
  ['- ^[x/*\\]*]](u)]\\][\n', '- ^[x/*\\]*]](u)]][\n'],
]

describe('C2-W-088, C2-W-125: nothing opens on the text behind a note that closes in place (#5456)', () => {
  it.each(cases)('writes %j as %j', (source, expected) => {
    const output = formatWithDiagnostics(source)
    expect(output.diagnostics).toEqual([])
    expect(output.source).toBe(expected)
    expect(treesEqual(parse(output.source), parse(source))).toBe(true)
    expect(format(output.source)).toBe(output.source)
  })
})
