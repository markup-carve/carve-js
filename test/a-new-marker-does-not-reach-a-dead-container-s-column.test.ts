import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 0, A NEW MARKER DOES NOT REACH A DEAD CONTAINER'S COLUMN (carve#1892).
 * A blank ends every open quote and every column opened inside one dies with
 * it. A later line that writes the marker again opens a NEW quote and inherits
 * nothing, so a definition two columns above that quote's content column, with
 * no item open, is paragraph text: published where it was written, registering
 * nothing.
 *
 * The item column used to survive its own quote, so the definition registered
 * document-wide while the page printed it as ordinary text - both halves at
 * once, which I5 permits under neither reading.
 */
describe('a new marker does not reach a dead container column', () => {
  it('publishes the definition and registers nothing', () => {
    const html = carveToHtml('> - x\n\n>   [r]: /url\n\n> [r][]\n')
    expect(html).toContain('<p>[r]: /url</p>')
    expect(html).not.toContain('href="/url"')
  })

  it('holds for an ordered item too', () => {
    const html = carveToHtml('> 1. x\n\n>    [r]: /url\n\n> [r][]\n')
    expect(html).not.toContain('href="/url"')
  })

  /**
   * The controls either side. A quote-marked blank does NOT end the quote, so
   * the item column survives it and the definition registers (carve-js#1584);
   * and at document level a list item is transparent across a blank, so the
   * unquoted shape is untouched by this.
   */
  it('leaves the quote-marked blank registering', () => {
    expect(carveToHtml('> - x\n>\n>   [r]: /url\n>\n> [r][]\n')).toContain('href="/url"')
  })

  it('leaves the adjacent shape registering', () => {
    expect(carveToHtml('> - x\n>   [r]: /url\n>\n> [r][]\n')).toContain('href="/url"')
  })

  it('leaves an unquoted loose item registering', () => {
    expect(carveToHtml('- x\n\n  [r]: /url\n\n[r][]\n')).toContain('href="/url"')
  })
})
