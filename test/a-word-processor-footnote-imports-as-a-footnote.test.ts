/*
 * Footnote-shaped HTML from a word processor imports as real footnotes.
 *
 * Ports markup-carve/carve-php#1303: the `word` and `google-docs` adapter
 * names existed and dispatched nothing, so every one of these documents
 * imported as a literal link beside an orphaned list - the reference kept its
 * `#fn1` href and the note body became an ordinary list item or paragraph.
 *
 * None of these producers uses the DPUB-ARIA roles. What all of them share is
 * a MUTUALLY LINKED ANCHOR PAIR - the body reference points at the note and
 * the note points back - and that pair, not a vendor class name and not the
 * `fn1`/`fnref1` id convention, is what binds them here.
 *
 * The input shapes are verbatim excerpts of real exports, with the exports'
 * own line-wrapping tabs written as spaces:
 * - Word "Save as Web Page": bjanderson70/sf-cross-cutting-concerns,
 *   CCCDocs/home.htm
 * - Word "Save as Web Page, Filtered": cf-convention.github.io,
 *   Data/cf-documents/cf-governance/cf2_whitepaper_final.html
 * - Google Docs "Download as HTML": Flucille/Flucille,
 *   "Stalins political skills.html"
 * - LibreOffice 24.2 Writer HTML export, generated locally
 * - Pandoc 1.x: jgm/pandoc tests/writer.html at tag 1.19.2.4
 */
import { describe, it, expect } from 'vitest'
import { htmlToCarve, carveToHtml } from '../src/index.js'

const importAs = (html: string, adapter: 'word' | 'google-docs' = 'word'): string =>
  htmlToCarve(html, { adapter }).value

/**
 * Word writes `name=` rather than `id=` on both anchors, quotes three
 * attributes three different ways, and brackets the separator in a
 * downlevel-revealed conditional (`<![if !supportFootnotes]>`), which is not
 * a comment in the HTML grammar - parse5 reads it as a bogus comment where
 * libxml hands it back as text, and the chrome test recognizes both.
 */
const WORD_SAVE_AS_WEB_PAGE = `<p class=MsoNormal>Static typing<a
style='mso-footnote-id:ftn1' href="#_ftn1" name="_ftnref1" title=""><span
class=MsoFootnoteReference><span style='mso-special-character:footnote'><![if !supportFootnotes]><span
class=MsoFootnoteReference><span style='font-size:11.0pt'>[1]</span></span><![endif]></span></span></a> matters.</p>
<div style='mso-element:footnote-list'><![if !supportFootnotes]><br clear=all>
<hr align=left size=1 width="33%">
<![endif]>
<div style='mso-element:footnote' id=ftn1>
<p class=MsoFootnoteText><a style='mso-footnote-id:ftn1' href="#_ftnref1"
name="_ftn1" title=""><span class=MsoFootnoteReference><span style='mso-special-character:
footnote'><![if !supportFootnotes]><span class=MsoFootnoteReference><span
style='font-size:10.0pt'>[1]</span></span><![endif]></span></span></a>
Static Object Orient Languages</p>
</div>
</div>`

/**
 * The filtered save drops every `mso-element` style, so the wrapper is a bare
 * `<div id="ftn1">` and only the anchors still pair.
 */
const WORD_FILTERED = `<p>Data<a href="#_ftn1" name="_ftnref1" title=""><span class="MsoFootnoteReference">[1]</span></a> centre.</p>
<div><br clear="all">
<hr align="left" size="1" width="33%">
<div id="ftn1">
<p class="MsoFootnoteText"><a href="#_ftnref1" name="_ftn1" title=""><span class="MsoFootnoteReference">[1]</span></a> NCAS British Atmospheric Data Centre</p>
</div>
</div>`

/**
 * Google Docs puts the `<sup>` OUTSIDE the anchor, gives every note its own
 * bare `<div>`, and leaves the separator as a body-level sibling.
 */
const GOOGLE_DOCS =
  '<p class="c4"><span class="c7">Stalin became General Secretary</span><sup class="c1"><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup><span class="c0">&nbsp;in 1922</span><sup class="c1"><a href="#ftnt2" id="ftnt_ref2">[2]</a></sup><span class="c0">.</span></p><hr class="c10"><div><p class="c5"><a href="#ftnt_ref1" id="ftnt1">[1]</a><span class="c2">&nbsp;General Secretary of the Communist Party.</span></p></div><div><p class="c5"><a href="#ftnt_ref2" id="ftnt2">[2]</a><span class="c2">&nbsp;Roy Medvedev, Let History Judge, Page 3</span></p></div>'

/**
 * LibreOffice names nothing `fn`: the pair is `sdfootnote1anc` against
 * `sdfootnote1sym`, and the id on the wrapper div is a third name again.
 */
const LIBREOFFICE = `<p>Body sentence one<a class="sdfootnoteanc" name="sdfootnote1anc" href="#sdfootnote1sym"><sup>1</sup></a>
continues.</p>
<p>Second para<a class="sdfootnoteanc" name="sdfootnote2anc" href="#sdfootnote2sym"><sup>2</sup></a>
ends.</p>
<div id="sdfootnote1"><p class="sdfootnote"><a class="sdfootnotesym" name="sdfootnote1sym" href="#sdfootnote1anc">1</a>The
 first note body.</p>
</div>
<div id="sdfootnote2"><p class="sdfootnote"><a class="sdfootnotesym" name="sdfootnote2sym" href="#sdfootnote2anc">2</a>Note
 two para one.</p>
 <p class="sdfootnote">Note two para two.</p>
</div>`

/**
 * Pandoc 1.x: `footnoteRef` in camelCase, no ARIA roles anywhere, and a
 * back-link carrying no attributes at all.
 */
const PANDOC_1X = `<p>Here is a footnote reference,<a href="#fn1" class="footnoteRef" id="fnref1"><sup>1</sup></a> and another.</p>
<div class="footnotes">
<hr />
<ol>
<li id="fn1"><p>Here is the footnote.<a href="#fnref1">&#8617;</a></p></li>
</ol>
</div>`

const PRODUCERS: Array<[string, string, string]> = [
  ['word save as web page', WORD_SAVE_AS_WEB_PAGE, 'Static Object Orient Languages'],
  ['word filtered', WORD_FILTERED, 'NCAS British Atmospheric Data Centre'],
  ['google docs', GOOGLE_DOCS, 'General Secretary of the Communist Party.'],
  ['libreoffice', LIBREOFFICE, 'The first note body.'],
  ['pandoc 1.x', PANDOC_1X, 'Here is the footnote.'],
]

describe('a word processor footnote imports as a footnote', () => {
  for (const [name, html, body] of PRODUCERS) {
    it(`${name}: the note becomes a definition and the reference binds to it`, () => {
      const imported = importAs(html)
      expect(imported).toContain('[^1]')
      expect(imported).toContain('[^1]: ')
      expect(imported).toContain(body)
    })

    it(`${name}: the back-link and its marker do not reach the note body`, () => {
      // A back-link is generated navigation, not content. Carried into the
      // body it renders as a stray link to a fragment that no longer exists,
      // and the marker it wraps ([1], 1, the return arrow) lands in the
      // note's text.
      const imported = importAs(html)
      expect(imported).not.toContain('#_ftnref')
      expect(imported).not.toContain('#fnref')
      expect(imported).not.toContain('#ftnt_ref')
      expect(imported).not.toContain('#sdfootnote1anc')
      expect(imported).not.toContain('↩')
      expect(imported).not.toContain('[^1]: [1]')
      expect(imported).not.toContain('[^1]: 1')
    })

    it(`${name}: the separator does not import as a thematic break`, () => {
      const imported = importAs(html)
      expect(imported).not.toContain('---')
      expect(imported).not.toContain('supportFootnotes')
    })

    it(`${name}: the import renders back as a footnote`, () => {
      const rendered = carveToHtml(importAs(html))
      expect(rendered).toContain('role="doc-noteref"')
      expect(rendered).toContain('role="doc-endnotes"')
      expect(rendered).toContain('<li id="fn1">')
      expect(rendered).toContain(body)
    })
  }

  it('the generic adapter leaves the shape alone', () => {
    // The adapter is the caller's declaration of provenance. `generic` takes
    // arbitrary HTML, where a mutually linked anchor pair is not proof of a
    // footnote.
    const imported = htmlToCarve(LIBREOFFICE).value
    expect(imported).not.toContain('[^1]')
    expect(imported).toContain('#sdfootnote1sym')
  })

  it('both adapter names recognize the shape', () => {
    const word = importAs(GOOGLE_DOCS, 'word')
    const docs = importAs(GOOGLE_DOCS, 'google-docs')
    expect(word).toBe(docs)
    expect(word).toContain('[^1]')
  })

  it('a reference with no target stays a link', () => {
    // Nothing binds it, and an unbound `[^N]` renders as the literal text
    // `[^N]`, which would lose the href as well. It stays the link the HTML
    // spelled, so nothing is lost and there is nothing to report.
    const imported = importAs('<p>Body<a href="#fn9" class="footnote-ref" id="fnref9"><sup>9</sup></a> tail.</p>')
    expect(imported).not.toContain('[^')
    expect(imported).toContain('(#fn9)')
  })

  it('an unreferenced definition stays visible content', () => {
    // Importing it as a definition would be worse than it looks: Carve
    // renders an unreferenced definition as NOTHING, so text that was visible
    // in the input would silently vanish from the output while still sitting
    // in the source. As ordinary content it stays visible, and the decision
    // is the same whatever container the producer used.
    const html =
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a> tail.</p>' +
      '<section class="footnotes"><hr /><ol>' +
      '<li id="fn1"><p>Note one.<a href="#fnref1" class="footnote-back">&#8617;</a></p></li>' +
      '<li id="fn2"><p>Nothing points here.</p></li>' +
      '</ol></section>'
    const imported = importAs(html)
    expect(imported).toContain('[^1]: Note one.')
    expect(imported).not.toContain('[^2]')
    expect(imported).toContain('Nothing points here.')
    expect(carveToHtml(imported)).toContain('Nothing points here.')
  })

  const SHARED: Array<[string, string]> = [
    [
      'marked as footnote-ref',
      '<p>A<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>' +
        ' and B<a href="#fn1" class="footnote-ref" id="fnref1-2"><sup>1</sup></a>.</p>' +
        '<section class="footnotes"><ol><li id="fn1"><p>Shared.' +
        '<a href="#fnref1" class="footnote-back">&#8617;</a></p></li></ol></section>',
    ],
    [
      'unmarked, google docs shaped',
      '<p>A<sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup>' +
        ' and B<sup><a href="#ftnt1" id="ftnt_ref1b">[1]</a></sup>.</p>' +
        '<div><p><a href="#ftnt_ref1" id="ftnt1">[1]</a> Shared.</p></div>',
    ],
  ]
  for (const [name, html] of SHARED) {
    it(`two references to one note both bind (${name})`, () => {
      // Only one of them can be the back-link's target, so the mutual pair
      // that confirms the note cannot confirm the second reference. It binds
      // because it addresses a block already known to be a note.
      const imported = importAs(html)
      const defs = imported.split('[^1]: ').length - 1
      const refs = imported.split('[^1]').length - 1 - defs
      expect(defs).toBe(1)
      expect(refs).toBe(2)
      expect(imported).toContain('A[^1] and B[^1].')
    })
  }

  it('a note body keeps its blocks', () => {
    const html =
      '<p>A<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>.</p>' +
      '<section class="footnotes"><ol><li id="fn1">' +
      '<p>First para.</p><ul><li>one</li><li>two</li></ul>' +
      '<p>Last para.<a href="#fnref1" class="footnote-back">&#8617;</a></p>' +
      '</li></ol></section>'
    const rendered = carveToHtml(importAs(html))
    expect(rendered).toContain('<p>First para.</p>')
    // `<li>one</li>`, matching carve-php: a bare-text `<li>` imports as a
    // TIGHT item (the ruled tight-li import, corpus-convert 27/28).
    expect(rendered).toContain('<li>one</li>')
    expect(rendered).toContain('<p>Last para.')
    expect(rendered.split('<li id="fn1">').length - 1).toBe(1)
    expect(rendered.slice(rendered.indexOf('<li id="fn1">'))).toContain('</ul>')
  })

  it('ids outside the convention still pair', () => {
    // The pair is resolved through the fragment each anchor addresses, and
    // the label is assigned 1..N over the notes in document order - `_ftn1`
    // and `sdfootnote1sym` are generated navigation an engine regenerates,
    // and neither is a label any Carve source could carry.
    const html =
      '<p>A<a href="#note-alpha" name="mark-alpha"><sup>*</sup></a>.</p>' +
      '<div id="wrap-alpha"><p><a name="note-alpha" href="#mark-alpha">*</a> Odd-id note.</p></div>'
    const imported = importAs(html)
    expect(imported).toContain('A[^1].')
    expect(imported).toContain('[^1]: Odd-id note.')
    expect(imported).not.toContain('note-alpha')
  })

  it('each note gets its own label', () => {
    const imported = importAs(GOOGLE_DOCS, 'google-docs')
    expect(imported).toContain('[^1]')
    expect(imported).toContain('[^2]')
    expect(imported).toContain('[^1]: ')
    expect(imported).toContain('[^2]: ')
  })

  it("the engine's own HTML still imports once under the adapter", () => {
    const html = carveToHtml('a[^n] b\n\n[^n]: the note body\n')
    const imported = importAs(html)
    expect(imported.split('[^1]: ').length - 1).toBe(1)
    expect(carveToHtml(imported)).toBe(html)
  })
})
