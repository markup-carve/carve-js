import { describe, expect, it } from 'vitest'
import { parseWithLayout, validateLayout } from '../src/index.ts'

// carve-js#5777, C2-L-056: a string with an unpaired surrogate keeps "utf-8", its source holding U+FFFD instead.
const utf8 = (text: string): number => new TextEncoder().encode(text).length

describe('the layout source of a string with an unpaired surrogate', () => {
  it('holds U+FFFD in place of the surrogate', () => {
    const { layout } = parseWithLayout('a\uD800b\n')
    expect(layout.encoding).toBe('utf-8')
    expect(layout.source).toBe('a�b\n')
    expect(layout.nodes.map((entry) => [entry.path, entry.startByte, entry.endByte])).toEqual([['/children/0', 0, 5]])
  })

  for (const [name, input, source] of [
    ['a lone low surrogate', 'a\uDC00b\n', 'a�b\n'],
    ['a reversed pair', '\uDC00\uD800\n', '��\n'],
    ['a surrogate at the end', 'x\uD83D', 'x�'],
    ['a surrogate in code', '```\n\uD800\n```\n', '```\n�\n```\n'],
    ['a pair, which stays', 'a😀b\n', 'a😀b\n'],
  ] as const) {
    it(`gives ${name} as well-formed text whose bytes the ranges count`, () => {
      const { document, layout } = parseWithLayout(input)
      expect(layout.source).toBe(source)
      expect(Math.max(...layout.nodes.map((entry) => entry.endByte))).toBeLessThanOrEqual(utf8(layout.source))
      expect(layout.nodes[0]?.endByte).toBe(document.children[0]?.pos?.endOffset)
      expect(() => validateLayout(JSON.parse(JSON.stringify(layout)))).not.toThrow()
    })
  }
})
