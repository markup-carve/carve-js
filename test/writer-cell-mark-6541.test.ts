import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

/** A table whose continuation rows the layout records: only `format` keeps them (C2-W-067). */
function checkFormats(source: string, expected: string): void {
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(expected)
  expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  expect(format(expected)).toBe(expected)
}

// carve#6541: span marks are read from the row line (C2-B-184), so a first cell line that is only a mark is escaped.
describe('C2-W-063: a cell whose first line is only a span mark takes the escape (carve#6541)', () => {
  it.each([
    ['| a |\n| \\^ |\n+ z |\n', '| a |\n| \\^ |\n+ z |\n'],
    ['| ^ |\n+ z |\n', '| \\^ |\n+ z |\n'],
    ['| a |\n| \\< |\n+ z |\n', '| a |\n| \\< |\n+ z |\n'],
    ['| a |\n| ^ z |\n', '| a |\n| ^ z |\n'],
  ])('writes %j as %j', checkFormats)
})
