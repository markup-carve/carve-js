import { describe, expect, it } from 'vitest'

import { parse, toAstJson } from '../src/index.js'

/*
 * A LINE BLOCK STANZA HOLDING A TAB STILL PLACES ITS COMMENT NODE
 * (markup-carve/carve-js#1323).
 *
 * A tab-bearing stanza publishes no position for its inlines, and that is
 * right: the verse text is RECONSTRUCTED with expanded tabs, whose display
 * width is not a source length, so PART 12 §4 forbids inventing a mapping for
 * anything measured from it. The ruling on markup-carve/carve-rs#1247 settled
 * that half explicitly - a tab-expanded `text` keeps NO position, in all three
 * engines - and the first assertion below pins it so a later change cannot
 * "fix" this one by fabricating an offset for the text.
 *
 * The `comment` was never measured from that text. It is a whole source LINE
 * the block layer emptied and the tree keeps (PART 9 §23), and its span comes
 * from the line table, before any rewriting. THE ARGUMENT IS THIS ENGINE
 * AGAINST ITSELF: on this same document it publishes the `hard_break` at
 * `9..10`, whose end is that comment line's first column, from the SAME line
 * table - so it has the information and used to decline to use it, while
 * carve-rs and carve-php published it.
 *
 * Measured as offsets AND as the source they select: a span that is merely
 * present proves nothing.
 */

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
  it('places no position on the text it rebuilt with expanded tabs', () => {
    const [text] = stanza(DOC).children!
    expect(text!.type).toBe('text')
    expect(spanOf(text!)).toBeNull()
  })

  it('places the break that ends the tab-bearing line, from line geometry', () => {
    const [, hardBreak] = stanza(DOC).children!
    expect(hardBreak!.type).toBe('hard_break')
    expect(spanOf(hardBreak!)).toEqual([9, 10])
    expect(sliceOf(DOC, hardBreak!)).toBe('\n')
  })

  it('places the comment from that same line table', () => {
    const [, , comment] = stanza(DOC).children!
    expect(comment!.type).toBe('comment')
    expect(spanOf(comment!)).toEqual([10, 12])
    expect(sliceOf(DOC, comment!)).toBe('%%')
  })

  it('keeps the comment inside the paragraph that holds it', () => {
    const paragraph = stanza(DOC)
    const [, , comment] = paragraph.children!
    expect(spanOf(paragraph)).toEqual([6, 12])
    expect(comment!.pos!.startOffset).toBeGreaterThanOrEqual(paragraph.pos!.startOffset)
    expect(comment!.pos!.endOffset).toBeLessThanOrEqual(paragraph.pos!.endOffset)
  })
})
