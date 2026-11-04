/*
 * PART 12 §4 (CARVE-P12-022): a refused wrapped brace run is one literal text
 * node whose lines are joined after their indent or quote prefix is stripped.
 * That value is not a source slice, so the node omits `pos`. A run whose lines
 * join without stripping anything is a slice and keeps its span.
 */
import { describe, it, expect } from 'vitest'
import { parse, renderCarve, renderHtml, toAstJson } from '../src/index.js'

type Node = { type: string; value?: string; pos?: { startOffset?: number; endOffset?: number }; [key: string]: unknown }

function firstParagraphText(node: Node): Node | undefined {
  if (node.type === 'paragraph') return (node.children as Node[])[0]
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof (child as Node).type === 'string') {
        const found = firstParagraphText(child as Node)
        if (found) return found
      }
    }
  }
  return undefined
}

function text(source: string): Node {
  return firstParagraphText(toAstJson(parse(source)) as unknown as Node)!
}

describe('a refused brace run joined across lines', () => {
  it.each([
    ['- {x\n  y}\n\n  b\n- a\n', '{x\ny}'],
    ['> {.c\n> }\n', '{.c\n}'],
    ['- {.a \n  .b}\n', '{.a\n.b}'],
  ])('omits pos when a stripped prefix joins it: %j', (source, value) => {
    const node = text(source)
    expect(node.type).toBe('text')
    expect(node.value).toBe(value)
    expect(node.pos).toBeUndefined()
  })

  it('keeps pos when the joined value is the source slice', () => {
    const node = text('- {x\ny}\n')
    expect(node.value).toBe('{x\ny}')
    expect(node.pos?.startOffset).toBe(2)
    expect(node.pos?.endOffset).toBe(7)
  })

  it('keeps pos on a source slice holding an astral character', () => {
    const node = text('{title="\u{1F600}"\n#x}\n')
    expect(node.value).toBe('{title="\u{1F600}"\n#x}')
    expect(node.pos?.startOffset).toBe(0)
    expect(node.pos?.endOffset).toBe(14)
  })

  it('changes neither the HTML nor the written form', () => {
    const source = '- {x\n  y}\n\n  b\n- a\n'
    expect(renderHtml(parse(source))).toContain('<p>{x\ny}</p>')
    expect(renderCarve(parse(source))).toBe('- {x\n  y}\n\n  b\n\n- a\n')
  })
})
