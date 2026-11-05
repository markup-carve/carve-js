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

/** Corpus 934: a one-item loose list whose body the writer rechecks on every render. */
const nested = '- o\n  - p\n    :: t\n    : x\n\n\n\n    : d\n'

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

  perfIt('formats a page of nested lists and escapes in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void carveToCarve(input),
      page,
      { label: 'nested-list blocks', smallRepeats: 3 },
    )
  })
})
