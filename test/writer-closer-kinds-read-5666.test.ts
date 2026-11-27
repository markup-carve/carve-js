import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics } from '../src/index.ts'

const collapsed = (lines: number): string => '[a *[a][]*[x]: /u\n'.repeat(lines)

// C2-W-005, C2-W-088 (carve-js#5666): the closer-kind switch changes a pass only where it keeps an escape the round
// asked for from giving its kind, so a kind pass that asked for no closer stands in for the closer-kind pass.
describe('C2-W-005: a kind pass that asked for no closer stands in for the closer-kind pass (carve-js#5666)', () => {
  it.each([682, 1820])('%i lines read back as written', (lines) => {
    const source = collapsed(lines)
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(out.source).toBe(source)
  })
})
