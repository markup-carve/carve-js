import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

function check(source: string, expected: string): void {
  expect(format(source)).toBe(expected)
  expect(writeWithDiagnostics(parse(source)).source).toBe(expected)
  expect(treesEqual(parse(expected), parse(source))).toBe(true)
  expect(format(expected)).toBe(expected)
}

describe('writer source-spelled reference link boundary', () => {
  it.each([
    ['[a][\\@\n\n[a]: /', '[a]\\[@\n\n[a]: /\n'],
    ['[name][\\@\n\n[name]: /', '[name]\\[@\n\n[name]: /\n'],
  ])('escapes a following unmatched bracket: %j', check)
})
