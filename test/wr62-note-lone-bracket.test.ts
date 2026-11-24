import { expect, test } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

test('a lone bracket in a note is escaped before the surrounding text note openers', () => {
  for (const [source, expected] of [
    ['^[^[,^[^[[^\\[]]]', '^\\[^\\[,^[^\\[[^[]]]'],
    ['^[[^[^\\[]]]', '^[\\[^[^[]]]'],
  ] as const) {
    expect(format(source)).toBe(`${expected}\n`)
    expect(treesEqual(parse(source), parse(expected))).toBe(true)
    expect(format(expected)).toBe(`${expected}\n`)
  }
})
