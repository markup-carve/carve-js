import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * THE CONTINUATION MARKER ATTACHES ONE BLOCK IN EVERY CONTAINER
 * (PART 9 §17 L3/L4, markup-carve/carve#1782 and carve#1788, corpus category
 * 427; markup-carve/carve-js#1532).
 *
 * `+` is ONE operation, not a family of per-container ones: ownership of the
 * next flush-left block passes to the container, ONE block, WHATEVER KIND it
 * is. The kind is not a parameter, and neither is the container.
 *
 * The two edges are only meaningful read against each other, so both are
 * pinned here:
 *
 *  - THE MARKER ATTACHES. Every block kind that can open flush-left is taken.
 *    The block quote tested for a `>` line in its attach boundary, so the one
 *    kind it refused was a quote: the `+` line vanished, `> q` folded into the
 *    quoted paragraph above it, and the marker did nothing at all - which the
 *    same clause forbids one sentence up ("the marker only ATTACHES").
 *  - IT ATTACHES ONE BLOCK. The block after that one stays outside, and a
 *    second block costs a second marker. Removing the `>` test could have been
 *    paid for by a wider reach; it was not, and category 427's four corpus
 *    documents are what says so - the same rule asked of all four containers.
 *
 * The reach is narrowed in ONE place (`collectAttachedBlock` re-parses the
 * collected lines through `attachedBlockExtent`), which is why every container
 * answers alike. A per-container extent is the drift carve#1782 was filed
 * about; keep it single.
 *
 * The four corpus documents themselves are no longer copied here. They were,
 * while this engine's spec pin predated them and `corpus.test.ts` could not run
 * the category - the same position carve-js#1528 and #1529 were in for
 * categories 424 and 422. The pin has moved past carve 70e794b0, the category is
 * in the corpus runner's IMPLEMENTED list, and the runner reads the files
 * themselves rather than a copy that can drift from them. The bands below are
 * this engine's own and stay.
 */
describe('the continuation marker attaches one block in every container', () => {
  /*
   * EDGE ONE: the marker attaches, whatever the kind. A quote was the only kind
   * the block quote refused, so the other kinds are carried alongside it - a
   * fix that special-cased the quote back in would satisfy the corpus document
   * for a block quote and still leave the boundary keyed on kind.
   */
  describe('a block quote attaches every kind', () => {
    it('attaches a quote', () => {
      expect(carveToHtml('> a\n+\n> q\n')).toContain('<blockquote><p>q</p></blockquote>')
    })

    it('attaches a paragraph', () => {
      expect(carveToHtml('> a\n+\npara\n')).toBe('<blockquote>\n  <p>a</p>\n  <p>para</p>\n</blockquote>')
    })

    it('attaches a list', () => {
      expect(carveToHtml('> a\n+\n- x\n')).toBe(
        '<blockquote>\n  <p>a</p>\n  <ul>\n    <li>x</li>\n  </ul>\n</blockquote>',
      )
    })

    it('attaches a heading', () => {
      expect(carveToHtml('> a\n+\n# h\n')).toBe(
        '<blockquote>\n  <p>a</p>\n  <h1 id="h">h</h1>\n</blockquote>',
      )
    })

    it('attaches a code fence', () => {
      expect(carveToHtml('> a\n+\n```\nc\n```\n')).toBe(
        '<blockquote>\n  <p>a</p>\n  <pre><code>c\n</code></pre>\n</blockquote>',
      )
    })

    it('attaches a table', () => {
      expect(carveToHtml('> a\n+\n| x |\n')).toContain('<table>')
    })
  })

  /*
   * EDGE TWO: it attaches ONE block, and a second costs a second marker. This
   * is what a wider reach would break, and a wider reach is the other half of
   * the same defect in the sibling engines (carve-php#1778, carve-rs#1428).
   */
  describe('the reach stops at one block in every container', () => {
    it('leaves the second block of a quote attachment at the top level', () => {
      expect(carveToHtml('> a\n+\np1\n\np2\n')).toBe(
        '<blockquote>\n  <p>a</p>\n  <p>p1</p>\n</blockquote>\n<p>p2</p>',
      )
    })

    it('leaves the second block of a list attachment at the top level', () => {
      expect(carveToHtml('- a\n+\np1\n\np2\n')).toBe(
        '<ul>\n  <li>a\n    p1\n  </li>\n</ul>\n<p>p2</p>',
      )
    })

    it('leaves the second block of a description attachment at the top level', () => {
      expect(carveToHtml(':: t\n:  a\n+\np1\n\np2\n')).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <p>p1</p>\n  </dd>\n</dl>\n<p>p2</p>',
      )
    })

    it('leaves the second block of a footnote attachment at the top level', () => {
      const html = carveToHtml('[^n]: a\n+\np1\n\np2\n\nsee[^n]\n')
      expect(html.startsWith('<p>p2</p>')).toBe(true)
      expect(html).not.toContain('<p>p2</p>\n      <p>')
    })

    it('takes a second block only with a second marker', () => {
      expect(carveToHtml('> a\n+\n> q\n+\n> r\n')).toBe(
        '<blockquote>\n  <p>a</p>\n  <blockquote><p>q</p></blockquote>\n  <blockquote><p>r</p></blockquote>\n</blockquote>',
      )
    })

    it('leaves a quote below an attached PARAGRAPH continuing the outer quote', () => {
      // The quote is still open, so the dedented `> q` is one of its own lines
      // rather than a second attached block. The corpus asks this of the three
      // containers that CLOSE instead; a quote is the one that does not.
      expect(carveToHtml('> a\n+\npara\n> q\n')).toBe(
        '<blockquote>\n  <p>a</p>\n  <p>para</p>\n  <p>q</p>\n</blockquote>',
      )
    })
  })
})
