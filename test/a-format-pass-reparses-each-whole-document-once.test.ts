import { describe, expect, it, vi } from 'vitest'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// Counts the source the parser reads, so the cost is measured in re-parsed
// bytes rather than in wall-clock time on a loaded runner.
const parsed = vi.hoisted(() => ({ sources: [] as string[] }))
vi.mock('../src/parse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/parse.js')>()
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      parsed.sources.push(args[0])
      return actual.parse(...args)
    },
  }
})

const { carveToCarve } = await import('../src/index.js')
const { parse } = await import('../src/parse.js')
const { renderedReadsBack, withReadbackMemo } = await import('../src/render-carve.js')

/** Corpus 934: a one-item loose list whose body the writer rechecks on every render. */
const nested = '- o\n  - p\n    :: t\n    : x\n\n\n\n    : d\n'

// With `isolate: false` another file may have loaded the engine unmocked first.
carveToCarve('x\n')
const counting = parsed.sources.length > 0

const page = (blocks: number): string =>
  Array.from({ length: blocks }, (_, i) => `${nested}\nText \\*${i} and *s* /x.\n\n%% c${i}\n\n`).join('')

describe('a format pass', () => {
  it('parses each whole-document source once', () => {
    parsed.sources = []
    expect(carveToCarve(nested)).toBe('- o\n  - p\n\n    :: t\n    : x\n\n    \\: d\n')
    const whole = parsed.sources.filter((source) => source.length * 2 >= nested.length)
    expect(whole.length).toBe(new Set(whole).size)
    // The readback checks and the loose-list recheck used to re-parse the same sources: 31 documents here.
    expect(parsed.sources.reduce((sum, source) => sum + source.length, 0) / nested.length).toBeLessThan(10)
  })

  it.skipIf(!counting)('parses each escape-search window once, the fixpoint check included', () => {
    const source = page(12)
    parsed.sources = []
    carveToCarve(source)
    const windows = parsed.sources.filter((reread) => reread.length * 2 < source.length)
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.length).toBe(new Set(windows).size)
  })

  it('keeps a readback whose verbatim payload count cannot be taken', () => {
    // Counting payloads spreads the top-level blocks onto a stack, which overflows here.
    const source = Array.from({ length: 130_000 }, (_, i) => `%% c${i}`).join('\n\n') + '\n'
    const document = parse(source)
    expect(withReadbackMemo(source, () => renderedReadsBack(document, source))).toBe(true)
  })

  perfIt('formats a page of nested lists and escapes in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void carveToCarve(input),
      page,
      { label: 'nested-list blocks', smallRepeats: 3 },
    )
  })
})
