import { describe, expect, it, vi } from 'vitest'
import * as blocks from '../src/ast-blocks.ts'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

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

// C2-W-088, C2-W-133 (carve-js#5666): a closer that a round frees takes the nearest open bracket of an earlier line, so
// the openers pass escaped one line per round. Those rounds go in batches that a real round confirms.
describe('C2-W-088: a bracket chain across lines takes a batch per round (carve-js#5666)', () => {
  it.each([168, 284, 644])('%i lines read back as written', (lines) => {
    const source = collapsed(lines)
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(out.source).toBe(source)
  })

  it('a chain in a quote reads back', () => {
    const source = collapsed(168).replace(/^/gmu, '> ')
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(treesEqual(parse(out.source), parse(source))).toBe(true)
  })

  it('the parses do not grow with the length of the chain', () => {
    // 168 lines chain 93 brackets in two passes, 644 lines 91 in each of two passes; one round each made about 200.
    expect(parses(() => formatWithDiagnostics(collapsed(168)))).toBeLessThan(60)
    expect(parses(() => formatWithDiagnostics(collapsed(644)))).toBeLessThan(90)
  })
})
