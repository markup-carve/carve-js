import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// C2-W-088, C2-I-047: the backslash of a hard break lets the delimiter before it open, so it takes its kind's escape.
const cases: readonly [string, string, string][] = [
  ['slash', 'x(/u)\\/\\\n', 'x(\\/u)\\/\\\n'],
  ['star', 'x(*u)\\*\\\nfoo', 'x(\\*u)\\*\\\nfoo\n'],
  ['slash in a list in a quote', '> - x(/u)\\/\\\n>   y', '> - x(\\/u)\\/\\\n>   y\n'],
  ['star in the class form of hard breaks', '{.hardbreaks}\n:::\nx(*u)\\*\\\nfoo\n:::\n', '::: hardbreaks\nx(\\*u)\\*\\\nfoo\n:::\n'],
  // C2-W-080: below the opener the break is the bare line ending, so the slash before it cannot open.
  ['slash below a hard-break opener', '::: \\\nx(/u)\\/\nfoo\n:::\n', '::: \\\nx(\\/u)/\nfoo\n:::\n'],
]

it.each(cases)('carve-js#5663: %s', (_name, source, expected) => {
  const written = format(source)
  expect(written).toBe(expected)
  expect(treesEqual(parse(written), parse(source))).toBe(true)
})
