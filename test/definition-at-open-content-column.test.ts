import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A definition belongs to whichever OPEN item's content column it lands on.
 *
 * `- - a` opens two items on one line, so two columns are live: 2 for the outer
 * item and 4 for the inner one. The link-definition prepass tested only the
 * innermost, so a definition at the outer column was consumed by the item and
 * registered by nobody: the author's line vanished and a reference to it stayed
 * literal - neither visible nor active, the outcome carve#624 named
 * (carve-js#643).
 *
 * The footnote form in the same position already worked, which is what made the
 * gap invisible: one document, two definition kinds, two answers.
 */
describe('a definition at an open content column', () => {
  it('registers at the OUTER column of a compact nested item', () => {
    expect(carveToHtml('- - a\n  [r]: /u\n\nsee [t][r]\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>\n<p>see <a href="/u">t</a></p>',
    )
  })

  it('registers at the INNER column too', () => {
    expect(carveToHtml('- - a\n    [r]: /u\n\nsee [t][r]\n')).toContain('href="/u"')
  })

  it('folds as text between two columns, defining nothing', () => {
    const html = carveToHtml('- - a\n   [r]: /u\n\nsee [t][r]\n')

    expect(html).toContain('[r]: /u')
    expect(html).toContain('<p>see [t][r]</p>')
  })

  it('agrees with the footnote form at the same column', () => {
    // The two definition kinds must answer the same question the same way.
    const link = carveToHtml('- - a\n  [r]: /u\n\nsee [t][r]\n')
    const note = carveToHtml('- - a\n  [^f]: x\n\nsee[^f]\n')

    expect(link).toContain('href="/u"')
    expect(note).toContain('doc-endnotes')
  })

  it('still registers a definition at a single item content column', () => {
    expect(carveToHtml('- a\n  [r]: /u\n\nsee [t][r]\n')).toContain('href="/u"')
  })
})
