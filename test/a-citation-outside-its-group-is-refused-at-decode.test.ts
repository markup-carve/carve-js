import { describe, expect, it } from 'vitest'
import { AstJsonMisplacedNodeTypeError, fromAstJson, renderHtml } from '../src/index.js'

/**
 * A `citation` outside `citation_group.items` is refused AT DECODE
 * (markup-carve/carve#2227).
 *
 * The type is one the schema names - `citation_group.items` holds it - so the
 * walk accepted it anywhere a node goes, and a paragraph holding one directly
 * reached `renderHtml: unknown inline citation` one step later. PART 12 §12(c)
 * puts that refusal at decode: a formatter, a linter or an indexer holds the
 * tree and never reaches a renderer at all.
 *
 * Measured before the fix, on the same payload: carve-php and carve-rs refuse
 * at decode, this engine accepted the tree and threw in the renderer. The
 * schema now spells the rule - `inlineNode` does not dispatch on `citation` -
 * and CARVE-P12-038 says why: an item is a typed positioned node INSIDE its
 * group, and no source can spell a bare one.
 */
const paragraph = (children: unknown[]) => ({
  type: 'document',
  srcByteLength: 0,
  children: [{ type: 'paragraph', children }],
})

const citation = { type: 'citation', key: 'x', suppressAuthor: false }

describe('a citation outside its group', () => {
  it('is refused at decode, naming the position the schema admits', () => {
    expect(() => fromAstJson(paragraph([citation]))).toThrow(AstJsonMisplacedNodeTypeError)
    expect(() => fromAstJson(paragraph([citation]))).toThrow(/only in citation_group\.items/)
  })

  it('is refused inside another inline, not only at the top of a paragraph', () => {
    const nested = paragraph([{ type: 'emphasis', emphasisType: 'strong', children: [citation] }])

    expect(() => fromAstJson(nested)).toThrow(AstJsonMisplacedNodeTypeError)
  })

  it('names the path, so a caller can find it', () => {
    expect(() => fromAstJson(paragraph([{ type: 'text', value: 'see ' }, citation]))).toThrow(
      /children\[0\]\.children\[1\]/,
    )
  })

  it('still reads a citation that sits in its group', () => {
    const doc = fromAstJson(
      paragraph([
        { type: 'text', value: 'see ' },
        { type: 'citation_group', raw: '[@x]', items: [citation] },
        { type: 'text', value: ' here' },
      ]),
    )

    expect(renderHtml(doc).trim()).toBe('<p>see [@x] here</p>')
  })
})
