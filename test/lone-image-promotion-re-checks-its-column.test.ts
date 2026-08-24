import { describe, expect, it } from 'vitest'
import { carveToAstJson, parse } from '../src/index.js'

/**
 * PROMOTION RE-CHECKS THE COLUMN ON THE PUBLISHED TREE
 * (`markup-carve/carve-js#1437`).
 *
 * `markup-carve/carve#1660` ruled that an INDENTED lone image is a paragraph
 * holding an inline image and not a top-level `image`, because a top-level block
 * opener must start at column 0. carve-rs and carve-php both took it. carve-js
 * held it on the PARSE tree and lost it on the PUBLISHED one.
 *
 * The syntactic block-image pass runs at parse time and correctly declines an
 * indented image. `promoteBlockImages` then ran again from `resolve()` - so a
 * reference image, which is never a syntactic block image, could reach block
 * position - and its sole-image arm promoted on "is this a real image" alone,
 * without re-asking what column the node sits at. The figure arm right below it
 * had asked that question since carve-js#1259; the sole-image arm never did.
 *
 * WHY A TEST AGAINST `parse()` WOULD PIN NOTHING, and why every assertion here
 * reads `carveToAstJson`. `resolve()` is where the promotion happens and it
 * mutates the tree in place, so `parse()` reports the paragraph whether or not
 * this bug is present. A test written against the parse tree passes today, on
 * the broken build, which is exactly how this survived: the cross-engine table
 * in `markup-carve/carve#1663` was built that way and reported carve-js as the
 * only engine that did NOT promote, when the tree its users receive promotes
 * like every other engine.
 *
 * THE COLUMN IS THE IMAGE'S, NOT THE LINE'S. `parseParagraph` strips a
 * paragraph's leading indentation, so the AST text cannot distinguish an
 * indented image from a flush one; `pos.startColumn === 1` is the test, and a
 * flush image at ANY container's dedented content column has `startColumn === 1`.
 * That is what the blockquote pair below pins, and it is the near miss a fix
 * that merely refused every indented-looking image would break.
 */
const published = (src: string) => carveToAstJson(src).children.map((n) => n.type)

describe('a lone image promotes only at its container content column', () => {
  it('declines an indented direct image, on the published tree', () => {
    expect(published(' ![a](u)\n')).toEqual(['paragraph'])
  })

  it('declines an indented resolved reference image, on the published tree', () => {
    expect(published(' ![a][r]\n\n[r]: u\n')).toEqual([
      'paragraph',
      'link_reference_definition',
    ])
  })

  it('declines an indented collapsed reference image, on the published tree', () => {
    expect(published(' ![a][]\n\n[a]: u\n')).toEqual([
      'paragraph',
      'link_reference_definition',
    ])
  })

  // The near miss. A fix that suppressed on "the source line starts with a
  // space" would take these too, and they must keep promoting.
  it('still promotes a flush direct image', () => {
    expect(published('![a](u)\n')).toEqual(['image'])
  })

  it('still promotes a flush resolved reference image', () => {
    expect(published('![a][r]\n\n[r]: u\n')).toEqual([
      'image',
      'link_reference_definition',
    ])
  })

  it('still promotes a flush collapsed reference image', () => {
    expect(published('![a][]\n\n[a]: u\n')).toEqual([
      'image',
      'link_reference_definition',
    ])
  })

  it('promotes at a container content column, and declines past it', () => {
    const inQuote = (src: string) => {
      const [quote] = carveToAstJson(src).children
      expect(quote!.type).toBe('block_quote')

      return (quote as { children: { type: string }[] }).children.map((n) => n.type)
    }
    // carve-rs 5e58310a and carve-php 0d4c73b3 both promote the first and
    // decline the second; this is the shape the ruling produces, not carve-js's
    // own reading of it.
    expect(inQuote('> ![a](u)\n')).toEqual(['image'])
    expect(inQuote('>  ![a](u)\n')).toEqual(['paragraph'])
  })

  it('leaves an unresolved reference a paragraph, flush or not', () => {
    expect(published('![a][nope]\n')).toEqual(['paragraph'])
    expect(published(' ![a][nope]\n')).toEqual(['paragraph'])
  })

  /**
   * The stage guard. If this ever fails, `parse()` has started resolving and
   * every assertion above stops being about the published exit specifically -
   * at which point this file needs rewriting rather than re-baselining.
   */
  it('reads a stage that parse() does not settle', () => {
    expect(parse('![a][r]\n\n[r]: u\n').children.map((n) => n.type)).toEqual([
      'paragraph',
      'link_reference_definition',
    ])
    expect(published('![a][r]\n\n[r]: u\n')).toEqual([
      'image',
      'link_reference_definition',
    ])
  })
})
