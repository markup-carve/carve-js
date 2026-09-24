import { describe, expect, it } from 'vitest'
import { fromAstJson } from '../src/index.js'

/*
 * A citation is only ever an item of a citation_group (markup-carve/carve#2227).
 *
 * carve-rs and carve-php refuse a standalone one at DECODE. This engine accepted
 * it and threw in the renderer - in all four of them - which is §9(b)'s "accepts
 * a tree and then renders only part of it", and worse for a consumer that never
 * reaches a renderer: a formatter or a language server simply carried the node.
 */

const pos = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 2, startOffset: 0, endOffset: 1 }
const citation = { type: 'citation', key: 'x', suppressAuthor: false, pos }
const para = (children: unknown[]) => ({
  type: 'document',
  srcByteLength: 0,
  children: [{ type: 'paragraph', children }],
})

describe('a standalone citation is refused at decode', () => {
  it('refuses one sitting directly in a paragraph', () => {
    expect(() => fromAstJson(para([{ type: 'text', value: 'see ' }, citation]) as never)).toThrow(
      /citation.*outside a citation_group/,
    )
  })

  it('refuses one in any other inline slot', () => {
    expect(() =>
      fromAstJson(para([{ type: 'link', href: '/u', children: [citation] }]) as never),
    ).toThrow(/citation.*outside a citation_group/)
  })

  it('refuses one nested in another citation, which is also an inline slot', () => {
    expect(() =>
      fromAstJson(
        para([{ type: 'citation_group', raw: '[@x]', items: [{ ...citation, prefix: [citation] }] }]) as never,
      ),
    ).toThrow(/citation.*outside a citation_group/)
  })

  it('accepts one inside its group, which is the shape the format is for', () => {
    expect(() =>
      fromAstJson(para([{ type: 'citation_group', raw: '[@x]', items: [citation] }]) as never),
    ).not.toThrow()
  })
})
