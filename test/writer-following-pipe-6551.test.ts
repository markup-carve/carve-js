import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

it('leaves a lone pipe bare below an escaped container opener', () => {
  const input = ':\n\\:::\n|\n'
  const expected = '\\:\n\\:::\n|\n'
  const tree = parse(input)
  expect(formatWithDiagnostics(input).source).toBe(expected)
  expect(writeWithDiagnostics(tree).source).toBe(expected)
  expect(treesEqual(parse(expected), tree)).toBe(true)
  expect(formatWithDiagnostics(expected).source).toBe(expected)
})
