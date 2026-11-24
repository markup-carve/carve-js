import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

it.each(['\\""%', '\\""!', "\\''/"])('waits for a text quote escape before repairing its neighbor: %j', (source) => {
  const input = `${source}\n`
  const tree = parse(input)
  expect(formatWithDiagnostics(input).source).toBe(input)
  expect(writeWithDiagnostics(tree).source).toBe(input)
  expect(treesEqual(parse(input), tree)).toBe(true)
})
