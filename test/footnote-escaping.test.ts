import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * A footnote must not escalate the whole document to conservative escaping.
 *
 * The W4 fallback renders twice - minimal and conservative - and keeps the
 * minimal form when the two parse the same. The comparison drops positional
 * fields, because an escape shifts every offset after it and the writer
 * renormalizes indentation, so positions differ for reasons the comparison is
 * not asking about.
 *
 * It dropped `pos` and `srcByteLength` and missed `footnoteDefPos`, which is
 * positional by the same argument. So ANY document containing a footnote
 * reported a difference that does not exist and got the conservative form -
 * `Carve has footnotes\.[^fn]` where nothing needed escaping. Twelve corpus
 * documents, and carve-rs and carve-php disagreed with this engine on every one
 * of them (carve#478).
 */
describe('footnotes do not force conservative escaping', () => {
  it('leaves a plain footnote document unescaped', () => {
    const source = 'Carve has footnotes.[^fn]\n\n[^fn]: Defined anywhere; resolved by label.\n'

    expect(carveToCarve(source)).toBe(source)
  })

  it('leaves an inline footnote unescaped', () => {
    const source = 'Text with a note.^[the note]\n'

    expect(carveToCarve(source)).toBe(source)
  })

  it('still escapes where the minimal form would change meaning', () => {
    // The fallback must remain reachable: dropping one key too many would look
    // like a fix while quietly disabling W4 for every document.
    //
    // These two need it. An indented `# H` and an indented `***` are a
    // paragraph, because both markers are column-0 only; the minimal writer
    // emits them unindented, where they would re-parse as a heading and a
    // thematic break. Only the conservative pass escapes them. Disabling the
    // fallback changes the rendered HTML of both, which is what makes this
    // assertion bite - a round-trip that holds either way would not.
    for (const source of ['   # H\n', ' ***\n']) {
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    }
  })

  it('preserves the document either way', () => {
    for (const source of [
      'Carve has footnotes.[^fn]\n\n[^fn]: Defined anywhere; resolved by label.\n',
      'A.[^a] B.[^b]\n\n[^a]: first\n\n[^b]: second\n',
      '> quoted.[^q]\n\n[^q]: note\n',
    ]) {
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    }
  })
})
