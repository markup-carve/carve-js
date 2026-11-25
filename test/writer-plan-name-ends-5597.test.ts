// carve-js#5597: the plan places the C2-W-125 case-six and case-nine backslashes, so these paragraphs need no parse.
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

describe('planned C2-W-125 backslashes of carve-js#5597', () => {
  it.each([
    ['x{#a\\_--}', 'x{#a\\_--} w0\n'],
    ['{_=\\._}', '{_\\=._} w0\n'],
    ['y {_a-b\\=c_}', 'y {_a-b\\=c_} w0\n'],
    ['x #a\\_-- w', 'x #a\\_-- w w0\n'],
    ['@b\\_c', '@b\\_c w0\n'],
  ])('C2-W-125: the plan writes %s with no parse', (shape, written) => {
    const result = planned(page(shape, 1))
    expect(result).toEqual({ written, parses: 0, repaired: 0 })
    expect(treesEqual(parse(written), parse(page(shape, 1)))).toBe(true)
    expect(format(written)).toBe(written)
  })

  it('C2-W-125, C2-W-091: shapes where the repair keeps another backslash stay with the repair', () => {
    // The rounds report the attribute block first and keep the backslash they placed for it. A strong of the tree
    // beside the stretch reports nothing, so its closing brace stays bare (carve#6687).
    expect(format('x{#a\\_--} *s*\n')).toBe('x{#a\\_--} *s*\n')
    expect(format('x{ #a\\_}\n')).toBe('x\\{ #a\\_}\n')
    expect(planned('x{#a\\_--} *s*\n').repaired).toBe(1)
  })

  it('the tag and underline pages take no parse at any size', () => {
    for (const shape of ['x{#a\\_--}', '{_=\\._}']) {
      for (const paragraphs of [64, 256]) expect(planned(page(shape, paragraphs)).parses).toBe(0)
    }
  })
})
