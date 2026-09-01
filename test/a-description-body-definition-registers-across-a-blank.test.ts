import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * §10 I5: a definition written at a definition body's content column is an
 * interrupter AND it registers. The parser already read it that way - the `dd`
 * comes back empty because the line is an invisible one - but the `afterTerm`
 * gate that strips the `: ` description marker asked the line DIRECTLY above.
 *
 * A blank line between entries does not end a definition list, it only makes it
 * loose, so after one the marker went unstripped, the definition was consumed
 * by the parser and collected by nobody, and the reference below it died. That
 * is the outcome carve#840 named for a quoted term, one blank line further up
 * (carve-js#1586).
 */
describe('a description-body definition registers across a blank', () => {
  it('registers across a blank between entries', () => {
    const html = carveToHtml(':: term\n:  def\n\n:  [r]: /url\n\n[r][]\n')
    expect(html).toContain('href="/url"')
    expect(html).not.toContain('[r]: /url')
  })

  it('registers when the description is the only one', () => {
    expect(carveToHtml(':: term\n\n:  [r]: /url\n\n[r][]\n')).toContain('href="/url"')
  })

  it('leaves the adjacent spelling alone, which always worked', () => {
    expect(carveToHtml(':: term\n:  def\n:  [r]: /url\n\n[r][]\n')).toContain('href="/url"')
  })

  /**
   * The blank is transparent only WHILE the list is open. Prose between the
   * entries ends it, and the `: ` line below is then paragraph text that
   * registers nothing - which is what the previous non-blank line says. This is
   * corpus 216's rule, reached through the new carry rather than around it.
   */
  it('refuses when prose between the entries ended the list', () => {
    const html = carveToHtml(':: term\n:  def\n\npara\n\n:  [r]: /url\n\n[r][]\n')
    expect(html).not.toContain('href="/url"')
    expect(html).toContain(':  [r]: /url')
  })

  it('refuses when a heading ended it', () => {
    expect(carveToHtml(':: term\n:  def\n\n# h\n\n:  [r]: /url\n\n[r][]\n')).not.toContain('href="/url"')
  })

  it('refuses a description marker with no term above it at all', () => {
    expect(carveToHtml('para\n\n:  [r]: /url\n\n[r][]\n')).not.toContain('href="/url"')
  })
})
