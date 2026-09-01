import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 9 §10 I5, spelled for a quote in 01-layout: "WITH THE MARKER WRITTEN
 * nothing about I5 changes: `> - x` over `>   [r]: /u` registers at the inner
 * item's content column." A blank line BETWEEN them is still inside the quote,
 * and a list item is transparent across a blank, so the item's content column
 * survives it (carve-js#1584).
 *
 * The pre-pass measured that blank on the raw line, where `>` is not blank at
 * all. It matched the block-opener test through the quote marker, popped the
 * column its own quote still held open, and the definition below then read as
 * top-level indentation and registered nowhere - while the block parser, which
 * asks a different question, consumed the same line AS a definition. The
 * document lost the reference and the line both.
 */
describe('a quote-marked blank keeps the item column open', () => {
  it('registers a definition written below a quote-marked blank', () => {
    const html = carveToHtml('> - x\n>\n>   [r]: /url\n>\n> [r][]\n')
    expect(html).toContain('href="/url"')
    expect(html).not.toContain('[r][]')
  })

  it('registers it with no blank line, the control that always worked', () => {
    expect(carveToHtml('> - x\n>   [r]: /url\n>\n> [r][]\n')).toContain('href="/url"')
  })

  it('registers under an ordered item too', () => {
    expect(carveToHtml('> 1. x\n>\n>    [r]: /url\n>\n> [r][]\n')).toContain('href="/url"')
  })

  it('registers at a deeper quote', () => {
    expect(carveToHtml('> > - x\n> >\n> >   [r]: /url\n> >\n> > [r][]\n')).toContain('href="/url"')
  })

  /**
   * The column the blank now preserves has to be one the parser really opens.
   * A definition list starts ONLY on a `::` term (PART 2: "The term marker is
   * TWO colons. A single-colon `: term` line is NOT a definition list -- it is
   * ordinary paragraph text"), so an ungated single-colon line handed the
   * pre-pass a content column against which a visibly literal definition then
   * registered. Before the blank was fixed a second bug hid this one: the
   * quote-marked blank popped the phantom column again.
   */
  it('does not register against a single-colon line, which is prose', () => {
    const html = carveToHtml('> : term\n>   def\n>\n>   [r]: /url\n>\n> [r][]\n')
    expect(html).toContain('<p>[r]: /url</p>')
    expect(html).not.toContain('href="/url"')
  })

  it('leaves a real `::` definition list reading as one', () => {
    expect(carveToHtml(':: term\n:  def\n')).toContain('<dt>term</dt>')
  })

  it('a quote-marked blank still ends the quote for an unmarked line below it', () => {
    const html = carveToHtml('> - x\n>\n[r]: /url\n\n[r][]\n')
    expect(html).toContain('href="/url"')
  })
})
