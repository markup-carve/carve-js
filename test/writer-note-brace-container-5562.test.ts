import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// A multi-line inline footnote in a container: the prefixes of its later lines shift the parse offsets (carve-js#5562).
const cases: readonly [string, string][] = [
  ['- ^[\n@\n\\[aa]}\n', '- ^[\n  @\n  \\[aa]}\n'],
  ['> ^[\n@\n\\[aa]}\n', '> ^[\n> @\n> \\[aa]}\n'],
  ['- a\n  - ^[\n@\n\\[aa]}\n', '- a\n  - ^[\n    @\n    \\[aa]}\n'],
  ['^[\n@\n\\[aa]}\n', '^[\n@\n\\[aa]}\n'],
]

it.each(cases)('writes %j with a bare brace behind the note', (source, expected) => {
  const written = format(source)
  expect(written).toBe(expected)
  expect(treesEqual(parse(written, { positions: false }), parse(source, { positions: false }))).toBe(true)
})
