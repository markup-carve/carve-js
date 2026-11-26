import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

it.each([
  ['::: |\n\\%%%\n', '::: |\n\\%%%\n:::\n'],
  ['- ::: |\n  \\%%%a\n', '- ::: |\n  \\%%%a\n  :::\n'],
])('escapes a comment fence in a line block: %j', (source, expected) => {
  const tree = parse(source)
  expect(formatWithDiagnostics(source).source).toBe(expected)
  expect(writeWithDiagnostics(tree).source).toBe(expected)
  expect(treesEqual(parse(expected), tree)).toBe(true)
  expect(formatWithDiagnostics(expected).source).toBe(expected)
})
