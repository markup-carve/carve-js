import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Content columns are measured INSIDE a block quote.
 *
 * `> - a` puts the item's content column at 2 of the QUOTED content. The
 * link-definition prepass measured the raw line, which carries the `> ` and
 * matches no marker, so the column stayed 0 and a definition written at it was
 * rejected as "indented at top level". The item consumed the line regardless,
 * so it rendered nothing AND defined nothing - the "neither visible nor active"
 * outcome carve#624 named (carve#658).
 *
 * The FOOTNOTE prepass already read the quoted line, so one document got two
 * answers depending on which definition kind was written.
 */
describe('a definition inside a quoted list item', () => {
  it('registers at the item content column', () => {
    expect(carveToHtml('> - a\n>   [r]: /u\n\nsee [t][r]\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>\n<p>see <a href="/u">t</a></p>',
    )
  })

  it('registers in a compact nested item too', () => {
    expect(carveToHtml('> - - a\n>   [r]: /u\n\nsee [t][r]\n')).toContain('href="/u"')
  })

  it('folds as text one column short of it', () => {
    const html = carveToHtml('> - a\n>  [r]: /u\n\nsee [t][r]\n')

    expect(html).toContain('[r]: /u')
    expect(html).toContain('<p>see [t][r]</p>')
  })

  it('agrees with the footnote form at the same column', () => {
    // The two definition kinds must answer the same question the same way.
    expect(carveToHtml('> - a\n>   [^f]: x\n\nsee[^f]\n')).toContain('doc-endnotes')
    expect(carveToHtml('> - a\n>   [r]: /u\n\nsee [t][r]\n')).toContain('href="/u"')
  })

  it('leaves the unquoted shape alone', () => {
    expect(carveToHtml('- a\n  [r]: /u\n\nsee [t][r]\n')).toContain('href="/u"')
  })
})
