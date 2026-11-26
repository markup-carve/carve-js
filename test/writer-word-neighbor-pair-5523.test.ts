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

describe('C2-W-069: a pair beside a word character takes its own braced form, not its owner (carve-js#5523)', () => {
  it.each([
    ['/{*a/b*}c/', '/{*a/b*}c/\n'],
    ['/{*a/b\\{*}c/', '/{*a/b\\{*}c/\n'],
    ['/x{*a/b*}/', '/x{*a/b*}/\n'],
    ['*{/a*b/}c*', '*{/a*b/}c*\n'],
    // Beside a space the strong can pair bare, so the emphasis takes the braced form (C2-I-053).
    ['/{*a/b*} c/', '{/*a/b* c/}\n'],
  ])('writes %j as %j', checkWrites)
})
