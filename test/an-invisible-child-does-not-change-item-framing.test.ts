import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A list item's framing is decided by how many children RENDER something. A
 * comment (PART 9 §4.13) and a raw block for another target both render '', and
 * an invisible child was enough to push a single-paragraph item out of the
 * compact form (carve-js#990):
 *
 *   - %% c        gave  <li>\n    y\n  </li>
 *     y           where the oracle and carve-php give  <li>y</li>
 *
 * The predicate is "renders nothing", decided by rendering rather than by a
 * type list, because two unrelated node types reach it and a third would be
 * added silently otherwise.
 *
 * Link and footnote definitions do NOT appear here - they are lifted to the
 * document - and an abbreviation definition inside an item is not recognized,
 * so it stays paragraph text. Both were measured before choosing the predicate.
 */
describe('an invisible child does not change a list item framing', () => {
  it.each([
    ['a line comment', '- %% c\n  y\n'],
    ['a comment fence', '- %%%\n  c\n  %%%\n  y\n'],
    ['a raw block for another target', '- ```=latex\n  \\x\n  ```\n  y\n'],
  ])('%s ahead of the paragraph keeps the compact form', (_name, source) => {
    expect(carveToHtml(source).replace(/\n+$/, '')).toBe('<ul>\n  <li>y</li>\n</ul>')
  })

  /**
   * BOUNDS. The comment in second position already worked, and these pin the
   * shapes the change must not touch. None of them moves under the mutation
   * below, so they are not evidence for the fix.
   */
  describe('unchanged', () => {
    it('a comment after the paragraph', () => {
      expect(carveToHtml('- y\n  %% c\n').replace(/\n+$/, '')).toBe('<ul>\n  <li>y</li>\n</ul>')
    })

    it('a plain item', () => {
      expect(carveToHtml('- x\n').replace(/\n+$/, '')).toBe('<ul>\n  <li>x</li>\n</ul>')
    })

    it('an item holding only a comment', () => {
      expect(carveToHtml('- %% c\n').replace(/\n+$/, '')).toBe('<ul>\n  <li></li>\n</ul>')
    })

    it('two real paragraphs still expand', () => {
      expect(carveToHtml('- a\n\n  b\n').replace(/\n+$/, '')).toBe(
        '<ul>\n  <li><p>a</p>\n    <p>b</p>\n  </li>\n</ul>',
      )
    })

    it('a paragraph followed by a nested list still expands', () => {
      expect(carveToHtml('- a\n  - b\n').replace(/\n+$/, '')).toBe(
        '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
      )
    })
  })
})
