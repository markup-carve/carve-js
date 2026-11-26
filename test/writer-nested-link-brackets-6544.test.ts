import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

// carve#6544: a nested link bounds no bracket pairs of the link text around it (C2-W-088, C2-W-125).
it.each([
  '[*[[*[x](u)]]](u)',
  '[[[[x](u)]](u)',
  '[*[[[*[[*[x](u)]]](u)]]](u)',
  '^*[*[[*'.repeat(49) + '^*[*x](u)' + '^]]](u)'.repeat(49),
  '^*[*[[*'.repeat(3) + '^[x]' + '^]]](u)'.repeat(3),
])('writes %s unchanged', (input) => {
  expect(formatWithDiagnostics(input)).toEqual({ source: `${input}\n`, diagnostics: [] })
})

it('still escapes a lone bracket of link text beside a nested link', () => {
  const input = '[a \\[ [b](u)](v)'
  const result = formatWithDiagnostics(input)
  expect(result.diagnostics).toEqual([])
  expect(treesEqual(parse(result.source), parse(input))).toBe(true)
})
