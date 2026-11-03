import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml } from '../src/index.js'

const tree = (source: string) =>
  JSON.stringify(carveToAstJson(source), (key, value) => (key === 'pos' || key === 'srcByteLength' ? undefined : value))

// carve#5022 ruling A: no empty payload line, which would be a blank that loosens a list (PART 17 L1c).
const cases: Array<[string, string, string]> = [
  ['a description lead in a list item', '- a\n  :: u\n  : %%%\n  %%%\n- c\n', '- a\n  :: u\n  : %%%\n    %%%\n- c\n'],
  ['a list marker line', '- %%%\n  %%%\n- c\n', '- %%%\n  %%%\n- c\n'],
  ['an item before its sibling', '- a\n  %%%\n  %%%\n- c\n', '- a\n  %%%\n  %%%\n- c\n'],
  ['a note lead', 'x[^n]\n\n[^n]: %%%\n  %%%\n', 'x[^n]\n\n[^n]: %%%\n  %%%\n'],
  ['the document', '%%%\n%%%\n', '%%%\n%%%\n'],
  ['an unclosed span', '%%%\n', '%%%\n%%%\n'],
]

describe('an empty comment span is written as adjacent delimiters', () => {
  for (const [host, source, expected] of cases) {
    it(`on ${host}`, () => {
      const written = carveToCarve(source)
      expect(written).toBe(expected)
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(tree(written)).toBe(tree(source))
      expect(carveToCarve(written)).toBe(written)
    })
  }

  it('keeps a payload of one empty line', () => {
    const source = '%%%\n\n\n%%%\n'
    expect(carveToAstJson(source)).toMatchObject({ children: [{ type: 'comment', content: '\n' }] })
    expect(carveToCarve(source)).toBe(source)
  })
})
