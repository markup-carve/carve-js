import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A heading inside a footnote body gets its generated id like a heading
 * anywhere else.
 *
 * `resolveHeadingIds` walks `doc.children`, and a footnote body does not live
 * there - it lives on `doc.footnoteDefs`. That map is already walked for
 * reference resolution and caption numbering; id assignment was the one pass
 * that skipped it, so a heading in a note came out as bare `<h1>H</h1>` while
 * the same heading in a block quote, a div or a list item got an id
 * (carve-js#669). carve-rs and carve-php both assign it.
 *
 * An id is what a fragment link and an implicit heading reference point at, so
 * the miss is not cosmetic: `[H]` resolves in the other two engines and not
 * here, for the same document.
 */
describe('heading ids inside a footnote body', () => {
  it('assigns the id, as it does in every other container', () => {
    const html = carveToHtml('[^a]: note\n\n  # H\n\nsee[^a]\n')

    expect(html).toContain('<h1 id="H">H</h1>')
  })

  it('shares the document id pool, so a duplicate is suffixed', () => {
    // The note body must not mint an id the document already used: two
    // elements with the same DOM id is invalid HTML, which is the reason
    // `reserveExplicitIds` exists at all. The suffix is this engine's
    // existing `-2` convention, not GitHub's `-1` - `# H` three times at
    // document level gives H, H-2, H-3.
    const html = carveToHtml('# H\n\n[^a]: note\n\n  # H\n\nsee[^a]\n')

    expect(html).toContain('id="H"')
    expect(html).toContain('id="H-2"')
  })

  it('suffixes across two notes as well', () => {
    const html = carveToHtml('[^a]: n\n\n  # H\n\n[^b]: m\n\n  # H\n\nsee[^a][^b]\n')

    expect(html).toContain('id="H"')
    expect(html).toContain('id="H-2"')
  })

  it('reserves an EXPLICIT id written inside a note body', () => {
    // The reservation pass has the same gap in the other direction: an
    // explicit id inside a note must be taken before a document heading
    // auto-slugs onto it.
    // The attribute line goes BEFORE the paragraph: after it, it is dangling
    // at the end of the note body and produces no output (section 15 A4).
    const html = carveToHtml('[^a]: note\n\n  {#H}\n  para\n\nsee[^a] and\n\n# H\n')

    expect(html).toContain('<p id="H">para')
    expect(html).toContain('id="H-2"')
  })

  it('resolves an implicit reference to a heading in a note', () => {
    const html = carveToHtml('[^a]: note\n\n  # Target\n\nsee[^a] and [Target][]\n')

    expect(html).toContain('href="#Target"')
  })

  /*
   * The boundary: headings OUTSIDE notes must keep behaving exactly as before,
   * including the section wrapper that only applies at document level.
   */
  it('leaves a document-level heading alone', () => {
    const html = carveToHtml('# H\n')

    expect(html).toContain('<section id="H">')
    expect(html).toContain('<h1>H</h1>')
  })
})
