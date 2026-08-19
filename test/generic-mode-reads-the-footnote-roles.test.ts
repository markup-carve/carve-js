/*
 * Every adapter, `generic` included, reads the DPUB-ARIA footnote roles
 * (markup-carve/carve-js#1105; carve-php core-policy parity): an anchor with
 * `role="doc-noteref"` and the `role="doc-endnotes"` section feed the same
 * footnote pass the word-processor adapters run. The roles are AUTHORED
 * semantics - an explicit signal - where the adapters' mutual anchor-pair
 * heuristic is an inference, so the heuristic and the vendor class names
 * stay adapter-gated, and a role-less document imports under `generic`
 * exactly as before.
 */
import { describe, it, expect } from 'vitest'
import { htmlToCarve, carveToHtml } from '../src/index.js'

/** Pandoc 2.11+ output shape: roles on the reference, back-link and section. */
const PANDOC_211 = `<p>Text<a href="#fn1" class="footnote-ref" id="fnref1" role="doc-noteref"><sup>1</sup></a> and more<a href="#fn2" class="footnote-ref" id="fnref2" role="doc-noteref"><sup>2</sup></a>.</p>
<section class="footnotes footnotes-end-of-document" role="doc-endnotes">
<hr />
<ol>
<li id="fn1"><p>First note.<a href="#fnref1" class="footnote-back" role="doc-backlink">&#8617;&#65038;</a></p></li>
<li id="fn2"><p>Second note.<a href="#fnref2" class="footnote-back" role="doc-backlink">&#8617;&#65038;</a></p></li>
</ol>
</section>`

describe('generic mode reads the footnote roles', () => {
  it('Pandoc 2.11+ HTML imports footnotes without naming an adapter', () => {
    // The same reference and definition bytes carve-php's core policy
    // produces for this document (php joins the definition lines with a
    // single newline where this writer separates blocks - a pre-existing
    // writer convention on both sides; each definition line is identical).
    expect(htmlToCarve(PANDOC_211).value).toBe(
      'Text[^1] and more[^2].\n\n[^1]: First note.\n\n[^2]: Second note.\n',
    )
  })

  it('generic and the word adapter agree on the role-marked document', () => {
    expect(htmlToCarve(PANDOC_211).value).toBe(htmlToCarve(PANDOC_211, { adapter: 'word' }).value)
  })

  it('the import renders back as footnotes', () => {
    const rendered = carveToHtml(htmlToCarve(PANDOC_211).value)
    expect(rendered).toContain('role="doc-noteref"')
    expect(rendered).toContain('role="doc-endnotes"')
    expect(rendered).toContain('<li id="fn1">')
    expect(rendered).toContain('First note.')
  })

  it("the engine's own rendered footnote HTML round-trips under generic", () => {
    const html = carveToHtml('a[^n] b\n\n[^n]: the note body\n')
    const imported = htmlToCarve(html).value
    expect(imported).toBe('a[^1] b\n\n[^1]: the note body\n')
    expect(carveToHtml(imported)).toBe(html)
  })

  it('a role-less document imports under generic exactly as before', () => {
    // The Pandoc 1.x shape: vendor classes, no roles. Those classes belong to
    // the adapters' heuristic, so under generic the reference stays the link
    // the HTML spelled and the note stays an ordinary list item.
    const noRoles =
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>.</p>' +
      '<section class="footnotes"><ol><li id="fn1"><p>The note.' +
      '<a href="#fnref1" class="footnote-back">&#8617;</a></p></li></ol></section>'
    const imported = htmlToCarve(noRoles).value
    expect(imported).not.toContain('[^')
    expect(imported).toContain('(#fn1)')
    expect(imported).toContain('The note.')
  })

  it('an unmarked mutual pair does not bind under generic either', () => {
    // The LibreOffice shape: a spelled back-link pair with no roles at all.
    // The mutual-pair inference is the adapters' license, not generic's.
    const libre =
      '<p>Body<a name="sdfootnote1anc" href="#sdfootnote1sym"><sup>1</sup></a>.</p>' +
      '<div id="sdfootnote1"><p><a name="sdfootnote1sym" href="#sdfootnote1anc">1</a> The note.</p></div>'
    const imported = htmlToCarve(libre).value
    expect(imported).not.toContain('[^')
    expect(imported).toContain('#sdfootnote1sym')
  })

  it('an unmarked anchor addressing a note stays the content link it is', () => {
    const withLink = PANDOC_211 + '\n<p>See <a href="#fn1">the first note</a>.</p>'
    const imported = htmlToCarve(withLink).value
    expect(imported).toContain('[^1]')
    expect(imported).toContain('See [the first note](#fn1).')
  })
})
