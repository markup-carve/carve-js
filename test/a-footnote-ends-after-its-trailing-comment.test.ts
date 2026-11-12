import { describe, expect, it } from 'vitest'
import { parse, toAstJson, type AstJsonBlock } from '../src/index.js'

type Spanned = { type: string; pos?: { startOffset?: number; endOffset?: number }; children?: Spanned[] }

const spans = (source: string): Spanned => {
  const footnote = toAstJson(parse(source)).children.find((node: AstJsonBlock) => node.type === 'footnote')
  return footnote as unknown as Spanned
}

const range = (node: Spanned | undefined): [number | undefined, number | undefined] =>
  [node?.pos?.startOffset, node?.pos?.endOffset]

// CARVE-P12-014: a container ends after its last placed child (carve-js#4984).
describe('a footnote ends after a comment it owns', () => {
  it.each([
    ['[^n]: t\n  %%\n', [0, 12]],
    ['[^n]: t\n\n  %%\n', [0, 13]],
    ['- [^n]: t\n    %%\n', [2, 16]],
    ['> [^n]: t\n>   %%\n', [2, 16]],
    ['- [^n]: - a\n    %%\n', [2, 18]],
  ])('%j', (source, expected) => {
    const footnote = spans(source)
    expect(footnote.children?.at(-1)?.type).toBe('comment')
    expect(range(footnote)).toEqual(expected)
    expect(range(footnote)[1]).toBe(range(footnote.children?.at(-1))[1])
  })

  it('leaves an outer note where a nested note collects the comment', () => {
    const notes = toAstJson(parse('[^a]: outer\n  [^b]: inner\n    %%\n')).children as unknown as Spanned[]
    expect(notes.map(range)).toEqual([[0, 11], [14, 32]])
    expect(notes[1]?.children?.at(-1)?.type).toBe('comment')
  })

  it('places a comment at a nested item column in that item', () => {
    const footnote = spans('- [^n]: - a\n          %%\n')
    const item = (footnote.children?.[0] as { items?: Spanned[] }).items?.[0]
    expect(item?.children?.at(-1)?.type).toBe('comment')
    expect(range(item)).toEqual([8, 24])
    expect(range(footnote)).toEqual([2, 24])
  })
})
