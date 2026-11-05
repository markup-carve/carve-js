/*
 * A refused wrapped brace run is paragraph text: each line ending is a
 * `soft_break` (carve-js#4430), so every piece is a source slice and keeps its
 * `pos` (CARVE-P12-022 no longer applies).
 */
import { describe, it, expect } from 'vitest'
import { parse, renderCarve, renderHtml, toAstJson } from '../src/index.js'

type Node = { type: string; value?: string; pos?: { startOffset?: number; endOffset?: number }; [key: string]: unknown }

function firstParagraph(node: Node): Node | undefined {
  if (node.type === 'paragraph') return node
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof (child as Node).type === 'string') {
        const found = firstParagraph(child as Node)
        if (found) return found
      }
    }
  }
  return undefined
}

function pieces(source: string): Array<[string, string | undefined, number | undefined, number | undefined]> {
  return (firstParagraph(toAstJson(parse(source)) as unknown as Node)!.children as Node[])
    .map((n) => [n.type, n.value, n.pos?.startOffset, n.pos?.endOffset])
}

describe('a refused brace run joined across lines', () => {
  it.each([
    ['- {x\n  y}\n\n  b\n- a\n', [['text', '{x', 2, 4], ['soft_break', undefined, 4, 7], ['text', 'y}', 7, 9]]],
    ['> {.c\n> }\n', [['text', '{.c', 2, 5], ['soft_break', undefined, 5, 8], ['text', '}', 8, 9]]],
    ['- {.a \n  .b}\n', [['text', '{.a', 2, 5], ['soft_break', undefined, 5, 9], ['text', '.b}', 9, 12]]],
    ['- {x\ny}\n', [['text', '{x', 2, 4], ['soft_break', undefined, 4, 5], ['text', 'y}', 5, 7]]],
  ])('splits at the line ending behind a stripped prefix: %j', (source, expected) => {
    expect(pieces(source)).toEqual(expected)
  })

  it('counts an astral character as one offset in each piece', () => {
    expect(pieces('{title="\u{1F600}"\n#x}\n')).toEqual([
      ['text', '{title="\u{1F600}"', 0, 10], ['soft_break', undefined, 10, 11], ['text', '#x}', 11, 14],
    ])
    expect(pieces('{%\u{1F600}\nx%}\n')).toEqual([
      ['text', '{%\u{1F600}', 0, 3], ['soft_break', undefined, 3, 4], ['text', 'x%}', 4, 7],
    ])
  })

  it('changes neither the HTML nor the written form', () => {
    const source = '- {x\n  y}\n\n  b\n- a\n'
    expect(renderHtml(parse(source))).toContain('<p>{x\ny}</p>')
    expect(renderCarve(parse(source))).toBe('- {x\n  y}\n\n  b\n\n- a\n')
  })
})
