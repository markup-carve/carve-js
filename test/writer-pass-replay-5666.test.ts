import { describe, expect, it, vi } from 'vitest'
import * as blocks from '../src/ast-blocks.ts'
import { formatWithDiagnostics } from '../src/index.ts'

vi.mock('../src/ast-blocks.ts', async (original) => {
  const actual = await original<typeof blocks>()
  return { ...actual, buildSource: vi.fn(actual.buildSource) }
})

const collapsed = (lines: number): string => '[a *[a][]*[x]: /u\n'.repeat(lines)

/** The parses `run` makes. */
function parses(run: () => unknown): number {
  const spy = vi.mocked(blocks.buildSource)
  spy.mockClear()
  run()
  return spy.mock.calls.length
}

// C2-W-088, C2-W-125 (carve-js#5666): every pass of a group repair starts again from the saved group, the pairs braced
// for their content or place included, so a C2-W-125 pass whose rounds the openers pass already ran takes its result.
describe('C2-W-088: a pass of the group repair that repeats an earlier one takes its result (carve-js#5666)', () => {
  it.each([284, 644])('%i lines read back as written', (lines) => {
    const source = collapsed(lines)
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(out.source).toBe(source)
  })

  it('the C2-W-125 pass after the openers pass runs no rounds of its own', () => {
    // Before: the openers pass ran its chain twice, 66 parses at 284 lines and 61 at 644 lines.
    expect(parses(() => formatWithDiagnostics(collapsed(284)))).toBeLessThan(50)
    expect(parses(() => formatWithDiagnostics(collapsed(644)))).toBeLessThan(50)
  })
})
