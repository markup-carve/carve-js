import { describe, expect, it } from 'vitest'
import { carveToCarve, parse } from '../src/index.js'

// PART 9 §28 [CARVE-P9-060] PAYLOAD INDENTATION, as ruled on markup-carve/carve#4988:
// the opener's indentation sets no payload base (carve-js#4308).

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

describe('a comment payload keeps its indentation past the host column', () => {
  it.each([
    ['a list item', '- head\n\n    %%%\n    a\n%%%\n    %%%\n    b\n    %%%\n\n  tail\n', ['  a', '  b']],
    ['a description', ':: t\n:  head\n\n     %%%\n     a\n%%%\n', ['  a']],
    ['a footnote', '[^f]: head\n\n    %%%\n    a\n    %%%\n', ['  a']],
    ['an opener at the content column', '- head\n\n  %%%\n    a\n  %%%\n', ['  a']],
    ['an item past one column', '- intro\n\n   %%%\n   hidden\n   %%%\n', [' hidden']],
    ['a quoted item', '> - a\n>\n>    %%%\n>     x\n>    %%%\n', ['  x']],
    ['a colon block', '::: box\n  %%%\n  a\n  %%%\n:::\n', ['  a']],
    ['a quote', '>   %%%\n>   a\n>   %%%\n', ['  a']],
    ['the document', '  %%%\n  a\n  %%%\n', ['  a']],
  ])('%s', (_name, source, expected) => {
    expect(comments(source)).toEqual(expected)
  })

  it('writes the payload under delimiters at the content column', () => {
    const source = '- head\n\n    %%%\n    a\n%%%\n    %%%\n    b\n    %%%\n\n  tail\n'
    const written = carveToCarve(source)
    expect(written).toBe('- head\n\n  %%%\n    a\n  %%%\n\n  %%%\n    b\n  %%%\n\n  tail\n')
    expect(comments(written)).toEqual(comments(source))
  })
})
