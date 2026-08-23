import { describe, expect, it } from 'vitest'

import { carveToHtml, htmlToCarve } from '../src/index.js'
import { LABEL_DEFAULTS } from '../src/render-html.js'

/**
 * PART 9 §16a, AN IMPORTER DOES NOT REPORT WHAT THE RENDERER DERIVES
 * (markup-carve/carve#1500, extended to the wrapper in
 * markup-carve/carve-php#1588).
 *
 * The endnotes `<section>` is written by `render-html.ts` around the notes: no
 * Carve construct spells a `<section>`, the `doc-endnotes` role is fixed, and
 * the name is the `endnotes` labels key at its documented default. All three
 * are RECONSTRUCTABLE from the element, which is the property that makes a
 * value derived - so none of them is the author's, and unwrapping the section
 * takes nothing an author wrote.
 *
 * The report said otherwise, with `element-unwrapped` plus `attribute-dropped`,
 * where carve-php said nothing. Both engines already wrote the same SOURCE for
 * this input, so the report was the only thing keeping the shape out of the
 * shared `tests/html-import` fixture set.
 *
 * WHY THE OUTPUT CANNOT BE THE TEST. The reference-less section degrades to the
 * `<hr>` and `<ol>` it is built from (markup-carve/carve#1558), so the renderer
 * writes NO section back for it - asking the emitted document whether the role
 * survived answers no, correctly, and then calls a non-loss a loss. Derivation
 * is a property of the element being read, not of what this import goes on to
 * do with it.
 *
 * THE CONTROLS ARE THE POINT, as they are for the value-matched rule this
 * extends. A section nothing derives still reports, an author's own class on a
 * derived section still reports, and a name the default does not match still
 * reports. Suppressing the element row and the attribute row together silenced
 * the last two of those while this was being written.
 */
describe('a derived endnotes section is not a reported loss', () => {
  const DERIVED = `<section role="doc-endnotes" aria-label="${LABEL_DEFAULTS.endnotes}"><hr><ol><li><p>Note text.</p></li></ol></section>`

  it('reports nothing for the wrapper or for the two attributes on it', () => {
    const result = htmlToCarve(DERIVED)
    expect(result.report.diagnostics).toEqual([])
  })

  it('writes the degraded form carve-php writes, byte for byte', () => {
    // carve-php#1585 settled this source, and the shared fixture pins it. It
    // gained the `{loose}` key in markup-carve/carve commit d2bd801b: a document with
    // ONE footnote imports as exactly one list item, a blank line needs two to
    // stand between, so before PART 9 §17 L7 the written source re-read TIGHT
    // and lost the `<p>` the imported tree recorded. The engine is ahead of the
    // pinned fixture until the next bump; `html-import-conformance.test.ts`
    // carries the matching AHEAD_OF_PIN entry.
    expect(htmlToCarve(DERIVED).value).toBe('---\n\n{loose}\n1. Note text.\n')
  })

  it('keeps the note text on the page', () => {
    expect(carveToHtml(htmlToCarve(DERIVED).value)).toContain('Note text.')
  })

  it('still reports a section nothing derives', () => {
    const codes = htmlToCarve('<section id="intro"><p>a</p></section>').report.diagnostics.map((d) => d.code)
    expect(codes).toEqual(['element-unwrapped', 'attribute-dropped'])
  })

  it('still reports an authored class riding on a derived section', () => {
    const html = '<section role="doc-endnotes" class="notes"><hr><ol><li><p>n</p></li></ol></section>'
    const diagnostics = htmlToCarve(html).report.diagnostics
    expect(diagnostics.map((d) => d.code)).toEqual(['attribute-dropped'])
    expect(diagnostics[0]!.message).toContain('class')
  })

  it('still reports a name the derived default does not match', () => {
    const html = '<section role="doc-endnotes" aria-label="Fussnoten"><hr><ol><li><p>n</p></li></ol></section>'
    const diagnostics = htmlToCarve(html).report.diagnostics
    expect(diagnostics.map((d) => d.code)).toEqual(['attribute-dropped'])
    expect(diagnostics[0]!.message).toContain('aria-label')
  })

  it('reports nothing for the referenced form either, which is consumed rather than unwrapped', () => {
    const html =
      '<p>Body<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>' +
      `<section role="doc-endnotes" aria-label="${LABEL_DEFAULTS.endnotes}"><hr><ol><li id="fn1"><p>Note text.</p></li></ol></section>`
    const result = htmlToCarve(html)
    expect(result.report.diagnostics).toEqual([])
    expect(result.value).toBe('Body[^1]\n\n[^1]: Note text.\n')
  })
})
