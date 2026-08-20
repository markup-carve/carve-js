import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { LABEL_DEFAULTS } from '../src/render-html.js'

/*
 * PART 9 §16 + §16a (markup-carve/carve#1455, markup-carve/carve#1456).
 *
 * `role="doc-backlink"` was already right and the accessible NAME was the
 * glyph, so a reader announced "leftwards arrow with hook" or skipped the link:
 * correct semantics, no way to know where it goes.
 */
describe('a footnote backlink says where it goes', () => {
  it('names a lone backlink with the label alone', () => {
    expect(carveToHtml('Text[^a]\n\n[^a]: Note body.\n')).toContain(
      '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>',
    )
  })

  it('names the k-th of several after what it visibly says', () => {
    // The number is the REFERENCE ORDINAL, matching the visible `<sup>k</sup>`
    // (WCAG 2.5.3). The note number is nowhere in this link's text.
    const html = carveToHtml('See[^a] and again[^a].\n\n[^a]: One note, two refs.\n')
    expect(html).toContain(
      '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference 1">↩<sup>1</sup></a>',
    )
    expect(html).toContain(
      '<a href="#fnref1-2" role="doc-backlink" aria-label="Back to reference 2">↩<sup>2</sup></a>',
    )
  })

  it('takes the string from the labels option', () => {
    const html = carveToHtml('Text[^a]\n\n[^a]: n\n', {
      labels: { footnoteBacklink: 'Zurück zur Fußnote' },
    })
    expect(html).toContain('aria-label="Zurück zur Fußnote"')
    expect(html).not.toContain('Back to reference')
  })

  it('escapes the label rather than emitting it raw', () => {
    // A label is TEXT, unlike a symbols-map value: a host reading its strings
    // from a translation catalog must not be handing us an injection vector.
    const html = carveToHtml('Text[^a]\n\n[^a]: n\n', {
      labels: { footnoteBacklink: '"><script>alert(1)</script>' },
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('keeps the English default when the option is absent', () => {
    expect(LABEL_DEFAULTS.footnoteBacklink).toBe('Back to reference')
  })
})
