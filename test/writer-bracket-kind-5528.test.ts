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

// carve-js#5528 (ruled): a bare parse that reports the kind `[` escapes every run of `[` in its block, and the
// backslash of a text `[^]` stays (C2-W-088, C2-W-091).
describe('C2-W-088: a reported bracket kind escapes the bracket of a text `[^]` (carve-js#5528)', () => {
  it.each([
    ['x ^\\[] [^]', 'x ^\\[] \\[^]\n'],
    ['\\^[][^]', '^\\[]\\[^]\n'],
    ['[^][^a\\]', '\\[^]\\[^a]\n'],
    ['^\\[x] \\[^]', '^\\[x] \\[^]\n'],
    ['^\\[x \\[^]]', '^\\[x \\[^]]\n'],
    ['+ ^\\[^]\n+ x \\[^]', '+ ^\\[^]\n+ x \\[^]\n'],
  ])('writes %j as %j', checkWrites)

  it.each([
    'x[[^](/u)\n',
    'x [^] y\n',
  ])('keeps %j bare where no round reports the kind', (source) => {
    checkWrites(source, source)
  })
})

// carve-js#5464 B: the trial behind a node stays in the round of the reported construct and gives no kind (C2-W-125, case six).
describe('C2-W-088: a trial behind a node gives no kind (carve-js#5528, carve-js#5464)', () => {
  it.each([
    ['.*{*b*\\**}x*z', '.{*\\{*b*}\\**}x*z\n'],
  ])('writes %j as %j', checkWrites)
})
