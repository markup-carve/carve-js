import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function checkWrites(source: string, expected: string): void {
  const tree = parse(source)
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), tree)).toBe(true)
  expect(formatWithDiagnostics(source, { normalize: true }).source).toBe(expected)
  expect(writeWithDiagnostics(tree).source).toBe(expected)
  expect(writeTreeWithStats(tree, undefined, 'plan').output.source).toBe(expected)
  expect(writeTreeWithStats(tree, undefined, 'repair').output.source).toBe(expected)
  expect(format(expected)).toBe(expected)
}

// carve-js#5470, C2-W-088: behind a first line that takes a backslash as a block opener, the bare parse reads the next
// line as the first line of a block. Where the plan cannot decide that line as a first line, the repair writes it.
describe('C2-W-088: a line the bare parse opens behind an escaped opener line (carve-js#5470)', () => {
  it.each([
    ['\\# a\n- [ ] a\n', '\\# a\n\\- [ ] a\n'],
    ['\\# a\na) a\n', '\\# a\na\\) a\n'],
    ['\\%% c\na) a\n', '\\%% c\na\\) a\n'],
    ['\\# a\n{{ x.crv }}\n', '\\# a\n\\{{ x.crv }}\n'],
    ['\\# a\n- c\n', '\\# a\n\\- c\n'],
  ])('writes %j as %j', checkWrites)
})
