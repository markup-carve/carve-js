import { describe, expect, it } from 'vitest'
import { carveToCarve, parse } from '../src/index.js'

// PART 9 §28 [CARVE-P9-060], as ruled on markup-carve/carve#4995: a span whose opener
// closes the item below it is measured from the host it lands in, and at document
// level nothing is removed.

const comments = (source: string): string[] => {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const n = node as { type?: string; content?: string; block?: boolean }
    if (n.type === 'comment' && n.block === true) out.push(n.content!)
    for (const [key, value] of Object.entries(n)) if (key !== 'pos') walk(value)
  }
  walk(parse(source))
  return out
}

describe('a comment span that ends its item keeps the columns its host leaves', () => {
  it.each([
    ['the document, corpus 187', '- a\n %%% n\n x\n %%%\n tail\n', ['n\n x']],
    ['the document, corpus 513', '- item\n %%%\n hidden\n%%%\ntail\n', [' hidden']],
    ['the document under an ordered item', '1. item\n  %%%\n  hidden\n   %%%\ntail\n', ['  hidden']],
    ['the document under two items', '- a\n  - item\n %%%\n hidden\n    %%%\ntail\n', [' hidden']],
    ['an outer item', '- - a\n   %%%\n  x\n    y\n   %%%\n', ['x\n  y']],
    ['a quote', '> - a\n>  %%%\n>  x\n>  %%%\n', [' x']],
  ])('%s', (_name, source, expected) => {
    expect(comments(source)).toEqual(expected)
  })

  it('writes a document-level payload with its columns', () => {
    const source = '- a\n %%% n\n x\n %%%\n tail\n'
    const written = carveToCarve(source)
    expect(written).toBe('- a\n\n%%%\nn\n x\n%%%\n\ntail\n')
    expect(comments(written)).toEqual(comments(source))
  })

  it('leaves a span the item keeps at the item column (corpus 513-8)', () => {
    expect(comments('- item\n %%%\n hidden\n  %%%\n  ```\ntail\n')).toEqual(['hidden'])
  })
})
