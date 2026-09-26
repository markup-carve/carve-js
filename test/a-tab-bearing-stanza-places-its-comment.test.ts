import { describe, expect, it } from 'vitest'

import { parse, toAstJson } from '../src/index.js'

// Comments and breaks retain their line-derived spans beside expanded tabs.
// Unchanged text is positioned; text merged across a synthesized space is not.

const DOC = '::: |\na\tb\n%%\n:::\n'

interface Node {
  type: string
  pos?: { startOffset: number; endOffset: number }
  children?: Node[]
}

/** The stanza's paragraph, from the SERIALIZED tree PART 12 is normative about. */
const stanza = (source: string): Node => {
  const doc = toAstJson(parse(source)) as unknown as Node
  return doc.children![0]!.children![0]!
}

const spanOf = (node: Node): [number, number] | null =>
  node.pos ? [node.pos.startOffset, node.pos.endOffset] : null

const sliceOf = (source: string, node: Node): string | null => {
  const span = spanOf(node)
  return span ? [...source].slice(span[0], span[1]).join('') : null
}

describe('a tab-bearing line block stanza', () => {
  it('places unchanged text and omits merged text containing a synthesized space', () => {
    const [text] = stanza(DOC).children!
    expect(text!.type).toBe('text')
    expect(spanOf(text!)).toEqual([6, 7])
    expect(sliceOf(DOC, text!)).toBe('a')
    const [merged] = stanza('::: |\ntab\tgap\n%%\n:::\n').children!
    expect(merged!.type).toBe('text')
    expect(spanOf(merged!)).toBeNull()
  })

  it('places the break that ends the tab-bearing line, from line geometry', () => {
    const hardBreak = stanza(DOC).children!.find(n => n.type === 'hard_break')
    expect(hardBreak!.type).toBe('hard_break')
    expect(spanOf(hardBreak!)).toEqual([9, 10])
    expect(sliceOf(DOC, hardBreak!)).toBe('\n')
  })

  it('places the comment from that same line table', () => {
    const comment = stanza(DOC).children!.find(n => n.type === 'comment')
    expect(comment!.type).toBe('comment')
    expect(spanOf(comment!)).toEqual([10, 12])
    expect(sliceOf(DOC, comment!)).toBe('%%')
  })

  it('keeps the comment inside the paragraph that holds it', () => {
    const paragraph = stanza(DOC)
    const comment = paragraph.children!.find(n => n.type === 'comment')
    expect(spanOf(paragraph)).toEqual([6, 12])
    expect(comment!.pos!.startOffset).toBeGreaterThanOrEqual(paragraph.pos!.startOffset)
    expect(comment!.pos!.endOffset).toBeLessThanOrEqual(paragraph.pos!.endOffset)
  })
})
