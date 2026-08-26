import { describe, it, expect } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

/**
 * markup-carve/carve-js#1552, spec markup-carve/carve#1784 (PART 9R R7, PART 12 §23).
 *
 * Block-image status is a property of the RESOLVED tree, not of the source
 * line. `![a][r]` is a block image where `[r]: /u` is written and ordinary
 * paragraph text where it is not, and the definition may sit anywhere in the
 * document -- so the question cannot be settled in the parser's forward pass.
 *
 * ONE promotion phase settles it after reference resolution, and it is the only
 * place that binds an image caption. Until it runs, a `^ ` line below an image
 * paragraph is an UNBOUND SLOT: not a caption, and not paragraph text. The
 * phase binds it where the paragraph is promoted, and hands its source lines
 * back -- ALL of them -- where it is not.
 *
 * The two give-back paths below are the ones on which a line of the document
 * can be lost: a slot MORE THAN ONE LINE wide, and a slot INSIDE A CONTAINER.
 * Corpus category 434 pins each with its resolved control beside it, and the
 * container row is markup-carve/carve-js#1553 -- the reference form inside a
 * container promoted but dropped its caption, while the inline form in the same
 * position and the reference form at top level both kept it.
 */
describe('block image is a resolved-tree property', () => {
  const html = (src: string) => renderHtml(parse(src)).trim()

  describe('the four rows R7 governs', () => {
    it('resolved, no caption: a bare block image', () => {
      expect(html('![a][r]\n\n[r]: /u\n')).toBe('<img src="/u" alt="a">')
    })

    it('resolved, with a caption: a figure', () => {
      expect(html('![a][r]\n^ cap\n\n[r]: /u\n')).toBe(
        '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>',
      )
    })

    it('unresolved, no caption: an ordinary paragraph', () => {
      expect(html('![a][r]\n')).toBe('<p>![a][r]</p>')
    })

    // The row that decides the model. Binding the caption on the source shape
    // would put a <figure> around a paragraph of literal `![a][r]`, which no
    // engine writes.
    it('unresolved, with a caption: the slot comes back as paragraph text', () => {
      expect(html('![a][r]\n^ cap\n')).toBe('<p>![a][r]\n^ cap</p>')
    })
  })

  describe('give-back path 1: a slot more than one line wide', () => {
    // EVERY line of the slot, not the marker line alone. Handing back only the
    // first line loses `continued` from the document.
    it('gives back every line of a multi-line slot', () => {
      expect(html('![a][r]\n^ cap one\ncontinued\n')).toBe('<p>![a][r]\n^ cap one\ncontinued</p>')
    })

    it('binds the whole multi-line slot when the reference resolves', () => {
      expect(html('![a][r]\n^ cap one\ncontinued\n\n[r]: /u\n')).toBe(
        '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap one\ncontinued</figcaption>\n</figure>',
      )
    })
  })

  describe('give-back path 2: a slot inside a container', () => {
    it('gives the slot back inside a list item', () => {
      expect(html('- ![a][r]\n  ^ cap\n')).toBe('<ul>\n  <li>![a][r]\n^ cap</li>\n</ul>')
    })

    // markup-carve/carve-js#1553: this promoted and dropped the caption.
    it('binds the slot inside a list item when the reference resolves', () => {
      expect(html('- ![a][r]\n  ^ cap\n\n[r]: /u\n')).toBe(
        '<ul>\n  <li>\n    <figure>\n      <img src="/u" alt="a">\n      <figcaption>cap</figcaption>\n    </figure>\n  </li>\n</ul>',
      )
    })

    // The controls that isolate #1553: the inline form in the same position,
    // and the reference form at top level, were both correct already.
    it('the inline form in the same position keeps its caption', () => {
      expect(html('- ![a](/u)\n  ^ cap\n')).toBe(
        '<ul>\n  <li>\n    <figure>\n      <img src="/u" alt="a">\n      <figcaption>cap</figcaption>\n    </figure>\n  </li>\n</ul>',
      )
    })

    it('binds the slot inside a block quote when the reference resolves', () => {
      expect(html('> ![a][r]\n> ^ cap\n\n[r]: /u\n')).toBe(
        '<blockquote>\n  <figure>\n    <img src="/u" alt="a">\n    <figcaption>cap</figcaption>\n  </figure>\n</blockquote>',
      )
    })

    it('gives the slot back inside a block quote', () => {
      expect(html('> ![a][r]\n> ^ cap\n')).toBe('<blockquote><p>![a][r]\n^ cap</p></blockquote>')
    })
  })
})
