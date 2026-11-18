import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

it('C2-W-002: a small decimal table width survives formatting', () => {
  const input = '{widths=0.0000001}\n| a |\n'
  const result = formatWithDiagnostics(input)
  expect(result.diagnostics).toEqual([])
  expect(treesEqual(parse(result.source), parse(input))).toBe(true)
  expect(result.source).toContain('0.0000001')
})
