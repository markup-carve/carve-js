import { expect, it } from 'vitest'
import { format } from '../src/index.ts'

// carve#6800: past the C2-I-118 cap a text `[` in link text whose bare form reads back takes no backslash (C2-W-088).
it.each([98, 99, 100, 101])('writes a refused bracket in link text bare behind %i lines', (lines) => {
  const input = '[a *[a](u)*[x]: /u\n'.repeat(lines) + '[a *[a](u)*\n'
  expect(format(input)).toBe(input)
})
