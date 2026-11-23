import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// carve#6466, C2-W-088: a row-shaped paragraph line has the line kind `|`, so only its first pipe takes a backslash.
const CASES: [string, string][] = [
  ['| a \\|\n', '\\| a |\n'],
  ['| a |\\|\n', '\\| a ||\n'],
  ['|a\\|\n', '\\|a|\n'],
  ['|= a \\|\n', '\\|= a |\n'],
  ['| a | b \\|\n', '\\| a | b |\n'],
  ['> p\n> | a |\\|\n', '> p\n> \\| a ||\n'],
  ['- |= a \\|\n', '- \\|= a |\n'],
  // The last pipe stands in a comment: the bare line is no row, so it takes no backslash.
  ['\\| %% c\\|\n', '| %% c\\|\n'],
]

describe('a row-shaped paragraph line (carve#6466)', () => {
  it.each(CASES)('writes %j as %j', (input, expected) => {
    const written = format(input)
    expect(written).toBe(expected)
    expect(treesEqual(parse(written), parse(input))).toBe(true)
    expect(format(written)).toBe(written)
  })
})
