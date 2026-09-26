import { describe, expect, it, vi } from 'vitest'

// Counts the source the parser reads, so the cost of the escape narrowing is
// measured in re-parsed bytes rather than in wall-clock time on a loaded runner.
const parsed = vi.hoisted(() => ({ bytes: 0 }))
vi.mock('../src/parse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/parse.js')>()
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      parsed.bytes += args[0].length
      return actual.parse(...args)
    },
  }
})

const { htmlToCarve } = await import('../src/index.js')

/** Every `* item` paragraph needs its escape, so the halving search runs out its budget. */
const page = (paragraphs: number): string =>
  '<body>' +
  Array.from({ length: paragraphs }, (_, i) => `<p class="n">* item ${i} and 1. two</p><p>plain *text* here ${i}.</p>`).join('') +
  '</body>'

describe('the escape narrowing search', () => {
  it('re-parses a few documents worth of source, not one per probe', () => {
    parsed.bytes = 0
    const carve = htmlToCarve(page(300)).value
    // Each probe used to re-parse the whole document: about 200 documents here.
    expect(parsed.bytes / carve.length).toBeLessThan(40)
  })

  it('keeps only the escapes each paragraph needs', () => {
    expect(htmlToCarve(page(2)).value).toBe(
      '{.n}\n\\* item 0 and 1. two\n\nplain \\*text* here 0.\n\n' +
        '{.n}\n\\* item 1 and 1. two\n\nplain \\*text* here 1.\n',
    )
  })
})
