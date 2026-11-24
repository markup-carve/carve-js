import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

function checkWrites(source: string, expected: string): void {
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  expect(writeWithDiagnostics(parse(source)).source).toBe(expected)
  expect(format(expected)).toBe(expected)
}

// carve-js#5565: the bare text reads no construct, so C2-W-125 case five escapes the lone `[` of the content and the
// text `[]` behind the extension stays bare; case six does not fit, since that bracket lengthens nothing.
describe('C2-W-125: a lone content bracket is escaped before the text behind its node (carve-js#5565)', () => {
  it.each([
    [':a[\\[][]', ':a[\\[][]\n'],
    [':a[x\\[][]', ':a[x\\[][]\n'],
    [':a[\\[][]x', ':a[\\[][]x\n'],
    ['p :a[\\[][]', 'p :a[\\[][]\n'],
    ['> :a[\\[][]', '> :a[\\[][]\n'],
    ['- :a[x\\[][]', '- :a[x\\[][]\n'],
    ['| :a[\\[][] |', '| :a[\\[][] |\n'],
  ])('writes %j as %j', checkWrites)

  // The bare text reads a link or a span the tree does not hold, so the kind `[` escapes every bracket (C2-W-088).
  it.each([
    [':a[\\[][x]', ':a[\\[]\\[x]\n'],
    ['p :ab-c[\\[]{.k}[x]', 'p :ab-c[\\[]{.k}\\[x]\n'],
    ['[\\[]{.c}[]', '[\\[]{.c}\\[]\n'],
  ])('writes %j as %j where a round reports the kind', checkWrites)
})
