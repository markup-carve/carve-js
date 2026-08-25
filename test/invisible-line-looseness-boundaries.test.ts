import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * Two boundaries of the §17 L1 invisible-line rule (#619, markup-carve/carve#621).
 *
 * The rule itself - an invisible construct is not the second PARAGRAPH that
 * loosens an item, but does not fill the gap before the next sibling either -
 * is covered by the corpus. These are the two edges where "invisible" stops,
 * and each was wrong in a different direction.
 *
 * Every expectation was measured against carve-php, which agrees on both.
 */
describe('the invisible-line exemption stops at', () => {
  it('treats a fenced comment and its payload as one invisible block', () => {
    expect(carveToHtml('- intro\n\n   %%%\n   hidden\n   %%%\n')).toBe(
      '<ul>\n  <li>intro</li>\n</ul>',
    )
  })

  describe('a `+` separator, which is not a blank the author wrote', () => {
    it('does not loosen with a comment behind it', () => {
      // The second-paragraph scan has always exempted a `+`-injected separator;
      // the sibling clause has to exempt it too, or the item goes loose through
      // the back door. The same document without the comment is tight, so the
      // comment must not be what changes the answer.
      expect(carveToHtml('- a\n+\n%% note\n- b\n')).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
    })

    it('does not loosen with an attribute line behind it', () => {
      expect(carveToHtml('- a\n+\n{.c}\n- b\n')).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
    })
  })

  describe('an attribute line one column past its container', () => {
    it('AT the content column renders nothing, so the item stays tight', () => {
      expect(carveToHtml('- a\n\n  {.c}\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
    })

    it('PAST it is literal text, so the item is loose', () => {
      // §15 makes an attribute line column-strict. One column further in it is
      // paragraph text and really does render, so it is a visible second
      // paragraph. A comment is not column-strict, which is the control below.
      expect(carveToHtml('- a\n\n   {.c}\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
    })

    it('a comment past the same column still renders nothing', () => {
      expect(carveToHtml('- a\n\n   %% n\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
    })
  })

  it('an attribute line still does not fill the gap before a sibling', () => {
    expect(carveToHtml('- a\n\n  {.c}\n- b\n')).toBe(
      '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>',
    )
  })

  it('a visible paragraph behind an attribute line still loosens', () => {
    // The scan looks PAST an invisible line rather than stopping at it, so a
    // real second paragraph hiding behind one is still found.
    expect(carveToHtml('- a\n\n  {.c}\n  text\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <p class="c">text</p>\n  </li>\n</ul>',
    )
  })
})
