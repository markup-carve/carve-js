import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

it('escapes both reported text openers before a footnote reference', () => {
  const input = '[\\`[^`]{c}\n'
  const expected = '\\[\\`[^`]{c}\n'
  const tree = parse(input)
  expect(formatWithDiagnostics(input).source).toBe(expected)
  expect(writeWithDiagnostics(tree).source).toBe(expected)
  expect(treesEqual(parse(expected), tree)).toBe(true)
  expect(formatWithDiagnostics(expected).source).toBe(expected)
})
