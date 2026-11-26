import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

function check(source: string, expected: string): void {
  expect(format(source)).toBe(expected)
  expect(writeWithDiagnostics(parse(source)).source).toBe(expected)
  expect(treesEqual(parse(expected), parse(source))).toBe(true)
  expect(format(expected)).toBe(expected)
}

describe('writer terminal delimiters after smart quotes', () => {
  it.each([
    ['\\*\'*', '\\*\'*\n'],
    ['\\*"*', '\\*"*\n'],
    ['\\/\'/','\\/\'/\n'],
    ['x \\*\'*', 'x \\*\'*\n'],
    ['> \\*\'*', '> \\*\'*\n'],
  ])('leaves a terminal closer bare: %j', check)
})
