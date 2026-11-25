// carve-js#5603: the plan places the case-six `\-` behind a tag and keeps the brace before it bare (carve#6687).
import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function page(shape: string, paragraphs: number): string {
  return `${Array.from({ length: paragraphs }, (_, at) => `${shape} w${at}`).join('\n\n')}\n`
}

function planned(source: string): { written: string, parses: number, repaired: number } {
  const { output, stats } = writeTreeWithStats(parse(source), undefined, 'plan', false, undefined, source)
  return { written: output.source, parses: stats.parses, repaired: stats.repaired }
}

describe('planned tag braces of carve-js#5603', () => {
  it.each([
    'x{#a\\-w}',
    'x{#a\\-w} c\\d',
    'x{#a\\_--} *s*',
    'x{@a\\-w}',
    'x{#a-b\\.c}',
    '#a\\-é',
  ])('C2-W-125: the plan writes %s with no parse', (shape) => {
    const source = page(shape, 1)
    expect(planned(source)).toEqual({ written: source, parses: 0, repaired: 0 })
    expect(format(source)).toBe(source)
  })

  it.each([
    // C2-W-091: another text backslash in the group keeps the brace backslash, which the repair places.
    ['x{#a\\-w} y{#b\\-w}', 'x\\{#a\\-w} y\\{#b\\-w} w0\n'],
    ['x\\{#a\\-w} \\*s*', 'x\\{#a\\-w} \\*s* w0\n'],
    ['x\\{#a\\-w\\---}', 'x\\{#a\\-w\\---} w0\n'],
  ])('C2-W-091: %s stays with the repair', (shape, written) => {
    const source = page(shape, 1)
    const result = planned(source)
    expect(result.written).toBe(written)
    expect(result.repaired).toBe(1)
    expect(treesEqual(parse(written), parse(source))).toBe(true)
  })

  it('the carve#6687 page takes no parse at any size', () => {
    for (const paragraphs of [64, 256]) {
      const source = ['x{#a\\-w}', 'x{#a\\-w} c\\d', 'x{#a\\_--} *s*'].map((shape) => page(shape, paragraphs)).join('\n')
      expect(planned(source).parses).toBe(0)
    }
  })
})
