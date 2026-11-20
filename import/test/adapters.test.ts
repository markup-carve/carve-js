// C2-M-102 to C2-M-110: the editor adapters, on the 0.1 producer fixtures
// (carve-js 0.1 `test/a-word-processor-footnote-imports-as-a-footnote.test.ts`).
import { describe, expect, it } from 'vitest'
import { CarveOptionError } from '../../src/options.ts'
import { importDocument, type Adapter } from '../src/index.ts'

const source = (html: string, adapter: Adapter = 'word'): string => importDocument(html, { from: 'html', adapter }).source

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
const WORD_FILTERED =
  '<p>Data<a href="#_ftn1" name="_ftnref1" title="">' +
  '<span class="MsoFootnoteReference">[1]</span></a> centre.</p>\n' +
  '<div><br clear="all">\n' +
  '<hr align="left" size="1" width="33%">\n' +
  '<div id="ftn1">\n' +
  '<p class="MsoFootnoteText"><a href="#_ftnref1" name="_ftn1" title="">' +
  '<span class="MsoFootnoteReference">[1]</span></a> NCAS British Atmospheric Data Centre</p>\n' +
  '</div>\n' +
  '</div>'

/**
 * Google Docs puts the `<sup>` OUTSIDE the anchor, gives every note its own
 * bare `<div>`, and leaves the separator as a body-level sibling.
 */
const GOOGLE_DOCS =
  '<p class="c4"><span class="c7">Stalin became General Secretary</span><sup class="c1"><a href="#ftnt1" id="ftnt' +
  '_ref1">[1]</a></sup><span class="c0">&nbsp;in 1922</span><sup class="c1"><a href="#ftnt2" id="ftnt_ref2">[2]</' +
  'a></sup><span class="c0">.</span></p><hr class="c10"><div><p class="c5"><a href="#ftnt_ref1" id="ftnt1">[1]</a' +
  '><span class="c2">&nbsp;General Secretary of the Communist Party.</span></p></div><div><p class="c5"><a href="' +
  '#ftnt_ref2" id="ftnt2">[2]</a><span class="c2">&nbsp;Roy Medvedev, Let History Judge, Page 3</span></p></div>'

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
  ['libreoffice', LIBREOFFICE, 'first note body.'],
  ['pandoc 1.x', PANDOC_1X, 'Here is the footnote.'],
]

describe('the note pass of word and google-docs', () => {
  for (const [name, html, body] of PRODUCERS) {
    it(`C2-M-106: ${name} imports its notes as footnotes without backlinks or separator`, () => {
      const result = importDocument(html, { from: 'html', adapter: 'word' })
      expect(result.source).toContain('[^1]')
      expect(result.source).toMatch(/^\[\^1\]: /m)
      expect(result.source).toContain(body)
      expect(result.source).not.toMatch(/#_ftnref|#fnref|#ftnt_ref|#sdfootnote1anc|↩|\*\*\*|supportFootnotes/)
      expect(result.diagnostics.filter(entry => entry.code !== 'import-whitespace-normalized')).toEqual([])
    })
  }

  it('C2-M-102: google-docs runs the same pass as word', () => {
    for (const [, html] of PRODUCERS) {
      expect(source(html, 'google-docs')).toBe(source(html, 'word'))
    }
  })

  it('C2-M-102: generic and the editor adapters leave anchor pairs as links', () => {
    for (const [, html] of PRODUCERS) {
      const generic = source(html, 'generic')
      expect(generic).not.toContain('[^1]')
      for (const adapter of ['tiptap', 'prosemirror', 'ckeditor', 'tinymce'] as const) {
        expect(source(html, adapter)).toBe(generic)
      }
    }
  })

  it('C2-M-102: an unknown adapter is refused', () => {
    expect(() => importDocument('<p>a</p>', { from: 'html', adapter: 'notion' as Adapter })).toThrow(CarveOptionError)
  })

  it('C2-M-103: a block that would be the whole document is refused', () => {
    expect(source('<span id="x">loose</span><p>Body<a href="#x" class="footnote-ref" id="rx"><sup>1</sup></a> tail.</p>'))
      .not.toContain('[^')
  })

  it('C2-M-103: a wrapper with an id that holds one named element is the block', () => {
    const imported = source('<p>Body<sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup> tail.</p>'
      + '<div id="wrap1"><p><a href="#ftnt_ref1" id="ftnt1">[1]</a> First half.</p><p>Second half.</p></div>')
    expect(imported).toBe('Body[^1] tail.\n\n[^1]: First half.\n\n  Second half.\n')
  })

  it('C2-M-104: a marked reference wins over document order', () => {
    expect(source('<div id="note"><p><a name="target" href="#ref">1</a> The note.</p></div>'
      + '<p>Body<a href="#target" name="ref" class="footnote-ref"><sup>1</sup></a> tail.</p>'))
      .toBe('Body[^1] tail.\n\n[^1]: The note.\n')
  })

  it('C2-M-104: a block holding another note is no note', () => {
    const imported = source('<p>x<a href="#a" name="ra"><sup>1</sup></a> y<a href="#b" name="rb"><sup>2</sup></a></p>'
      + '<div id="a"><p>outer<a href="#ra">back</a></p><div id="b"><p>inner<a href="#rb">back</a></p></div></div>')
    expect(imported.match(/^\[\^\d+\]: /gm)).toHaveLength(1)
    expect(imported).toContain('[^1]: inner')
    expect(imported).toContain('outer')
  })

  it('C2-M-104: a second reference to a note binds to it', () => {
    expect(source('<p>A<sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup> and B<sup><a href="#ftnt1" id="ftnt_ref1b">[1]</a></sup>.</p>'
      + '<div><p><a href="#ftnt_ref1" id="ftnt1">[1]</a> Shared.</p></div>')).toBe('A[^1] and B[^1].\n\n[^1]: Shared.\n')
  })

  it('C2-M-107: a note of a footnote section keeps its place and its key', () => {
    expect(source('<p>Body<a href="#fn7" class="footnote-ref" id="fnref7"><sup>7</sup></a>.</p>'
      + '<section class="footnotes"><ol><li id="fn7"><p>The note.<a href="#fnref7">&#8617;</a></p></li></ol></section>'))
      .toBe('Body[^7].\n\n[^7]: The note.\n')
  })

  it('C2-M-107: a key a footnote section gives is skipped', () => {
    expect(source('<p>A<a role="doc-noteref" href="#fn1">1</a> B<sup><a href="#n2" id="r2">2</a></sup>.</p>'
      + '<div><p><a href="#r2" id="n2">2</a> Moved.</p></div>'
      + '<section role="doc-endnotes"><ol><li id="fn1"><p>Kept.</p></li></ol></section>'))
      .toContain('B[^2].')
  })
})

describe('the pass is linear', () => {
  it('C2-M-105: a document of 2,000 Google Docs notes imports', () => {
    const notes = Array.from({ length: 2000 }, (_, at) => at + 1)
    const html = `<p>${notes.map(n => `w<sup><a href="#ftnt${n}" id="ftnt_ref${n}">[${n}]</a></sup>`).join(' ')}</p>`
      + notes.map(n => `<div><p><a href="#ftnt_ref${n}" id="ftnt${n}">[${n}]</a> Note ${n}.</p></div>`).join('')
    const imported = source(html)
    expect(imported).toContain('[^2000]: Note 2000.')
  })
})

describe('the pass is linear in the references of one note', () => {
  it('C2-M-104: 20,000 references to one note import', () => {
    const refs = Array.from({ length: 20000 }, (_, at) => `<a href="#note"${at === 0 ? ' id="ref"' : ''}>x</a>`).join('')
    const imported = source(`<p>${refs}</p><div id="note"><p><a href="#ref">1</a> Note.</p></div>`)
    expect(imported.match(/\[\^1\](?!:)/g)).toHaveLength(20000)
  })
})
