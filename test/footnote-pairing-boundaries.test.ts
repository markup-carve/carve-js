/*
 * The edges of the footnote pairing rule, one case per guard - ported from
 * markup-carve/carve-php#1303/#1307 so the two engines pin the same
 * decisions. These are the branches the producer fixtures never reach: how
 * far a note's block may grow, which end of a mutual pair is the reference,
 * what a note's body may keep, and what the pass must not touch.
 */
import { describe, it, expect } from 'vitest'
import { htmlToCarve, carveToHtml } from '../src/index.js'

const importAsWord = (html: string): string => htmlToCarve(html, { adapter: 'word' }).value

/** One note with a marked back-link, for the reference-site cases. */
const NOTE =
  '<section class="footnotes"><ol><li id="fn1"><p>The note.' +
  '<a href="#fnref1" class="footnote-back">&#8617;</a></p></li></ol></section>'

describe('footnote pairing boundaries', () => {
  it('a note block that would be the whole fragment is refused', () => {
    // Where the fragment lands on inline content with no block of its own,
    // the nearest block is the root the fragment was wrapped in - taking it
    // would move every paragraph in the document into one note.
    const html =
      '<span id="x">loose target</span>' +
      '<p>Body<a href="#x" class="footnote-ref" id="rx"><sup>1</sup></a> tail.</p>'
    const imported = importAsWord(html)
    expect(imported).not.toContain('[^1]')
    expect(imported).toContain('Body')
    expect(imported).toContain('loose target')
  })

  it('a note block is refused when the climb leaves the document', () => {
    // The same refusal in a full document: fragment parsing strips the
    // `<html>`/`<body>` wrappers, so the climb runs off the top the same way.
    const html =
      '<html><body><span id="x">loose target</span>' +
      '<p>Body<a href="#x" class="footnote-ref" id="rx"><sup>1</sup></a> tail.</p></body></html>'
    const imported = importAsWord(html)
    expect(imported).not.toContain('[^1]')
    expect(imported).toContain('loose target')
  })

  it('the climb counts an id-addressed target', () => {
    // The guarded climb counts targets addressed by `id` as well as by the
    // legacy `<a name>` the Word and LibreOffice fixtures use, so a wrapper
    // holding one id-addressed note is still the note's block.
    const html =
      '<p>Body<sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup> tail.</p>' +
      '<div id="wrap1"><p><a href="#ftnt_ref1" id="ftnt1">[1]</a> First half.</p>' +
      '<p>Second half.</p></div>'
    const rendered = carveToHtml(importAsWord(html))
    expect(rendered).toContain('<li id="fn1">')
    expect(rendered).toContain('First half.')
    // The wrapper is the note, so its second paragraph stays inside the note.
    expect(rendered.slice(rendered.indexOf('<li id="fn1">'))).toContain('Second half.')
  })

  it('a reference with no id binds on its marker', () => {
    // No id means no pair to read from the other end.
    const html =
      '<p>Body<a href="#fn1" class="footnote-ref"><sup>1</sup></a> tail.</p>' +
      '<section class="footnotes"><ol><li id="fn1"><p>The note.</p></li></ol></section>'
    const imported = importAsWord(html)
    expect(imported).toContain('Body[^1] tail.')
    expect(imported).toContain('[^1]: The note.')
  })

  it('a marked reference wins over document order', () => {
    const html =
      '<div id="note"><p><a name="target" href="#ref">1</a> The note.</p></div>' +
      '<p>Body<a href="#target" name="ref" class="footnote-ref"><sup>1</sup></a> tail.</p>'
    const imported = importAsWord(html)
    expect(imported).toContain('Body[^1] tail.')
    expect(imported).toContain('[^1]: The note.')
  })

  it('a back-link marker decides the other end is the reference', () => {
    const html =
      '<div id="note"><p><a name="target" href="#ref" class="footnote-back">1</a>' +
      ' The note.</p></div>' +
      '<p>Body<a href="#target" name="ref"><sup>1</sup></a> tail.</p>'
    const imported = importAsWord(html)
    expect(imported).toContain('Body[^1] tail.')
    expect(imported).toContain('[^1]: The note.')
  })

  it('a block holding another note is not itself a note', () => {
    // Keeping both would move one subtree into two places at once.
    const html =
      '<p>x<a href="#a" name="ra"><sup>1</sup></a> y<a href="#b" name="rb"><sup>2</sup></a></p>' +
      '<div id="a"><p>outer<a href="#ra">back</a></p>' +
      '<div id="b"><p>inner<a href="#rb">back</a></p></div></div>'
    const imported = importAsWord(html)
    expect(imported.split(']: ').length - 1).toBe(1)
    expect(imported).toContain('[^1]: inner')
    expect(imported).toContain('outer')
  })

  it('an external link is not swept up', () => {
    const html =
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>' +
      ' and <a href="https://example.com">a site</a>.</p>' + NOTE
    const imported = importAsWord(html)
    expect(imported).toContain('[a site](https://example.com)')
    expect(imported).toContain('[^1]: The note.')
  })

  it('a link inside a note is not a reference', () => {
    // A note's own body may address another note without that link turning
    // into a second reference to it.
    const html =
      '<p>A<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>' +
      ' B<a href="#fn2" class="footnote-ref" id="fnref2"><sup>2</sup></a>.</p>' +
      '<section class="footnotes"><ol>' +
      '<li id="fn1"><p>One, see <a href="#fn2">the other</a>.' +
      '<a href="#fnref1" class="footnote-back">&#8617;</a></p></li>' +
      '<li id="fn2"><p>Two.<a href="#fnref2" class="footnote-back">&#8617;</a></p></li>' +
      '</ol></section>'
    const imported = importAsWord(html)
    expect(imported).toContain('A[^1] B[^2].')
    expect(imported).toContain('[the other](#fn2)')
    expect(imported.split(']: ').length - 1).toBe(2)
  })

  it("a content link in a note body survives", () => {
    const html =
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>.</p>' +
      '<section class="footnotes"><ol><li id="fn1">' +
      '<p>See <a href="https://example.com/paper">the paper</a>.' +
      '<a href="#fnref1" class="footnote-back">&#8617;</a></p>' +
      '</li></ol></section>'
    const imported = importAsWord(html)
    expect(imported).toContain('[the paper](https://example.com/paper)')
    expect(imported).not.toContain('#fnref1')
  })

  it('the wrapper around a back-link goes with it', () => {
    // Rather than staying behind as an empty superscript.
    const html =
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>.</p>' +
      '<section class="footnotes"><ol><li id="fn1"><p>The note.' +
      '<sup><a href="#fnref1" class="footnote-back">&#8617;</a></sup></p></li></ol></section>'
    expect(importAsWord(html)).toBe('Body[^1].\n\n[^1]: The note.\n')
  })

  it('a comment does not keep the emptied container alive', () => {
    const html =
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a>.</p>' +
      '<div class="footnotes"><!-- endnotes --><hr /><ol>' +
      '<li id="fn1"><p>The note.<a href="#fnref1" class="footnote-back">&#8617;</a></p></li>' +
      '</ol></div>'
    expect(importAsWord(html)).toBe('Body[^1].\n\n[^1]: The note.\n')
  })

  it('a sup holding more than the reference survives', () => {
    // Only a superscript that wraps the anchor and nothing else is replaced
    // with it; one that also carries an element of its own keeps its content,
    // and the reference binds inside it.
    const html =
      '<p>Body<sup><a href="#fn1" class="footnote-ref" id="fnref1">1</a><span>*</span></sup> t.</p>' + NOTE
    const imported = importAsWord(html)
    const rendered = carveToHtml(imported)
    expect(imported).toContain('Body{^[^1]*^} t.')
    expect(rendered).toContain('role="doc-noteref"')
    expect(rendered).toContain('*</sup>')
  })

  it('a sup holding text beside the reference survives', () => {
    // The same where the extra content is text - here brackets, which must
    // not read as a wiki link on the way back through the parser.
    const html = '<p>Body<sup>[<a href="#fn1" class="footnote-ref" id="fnref1">1</a>]</sup> t.</p>' + NOTE
    const imported = importAsWord(html)
    const rendered = carveToHtml(imported)
    expect(imported).toContain('Body{^[[^1]]^} t.')
    expect(rendered).toContain('<sup>[<a id="fnref1" href="#fn1" role="doc-noteref">')
  })

  it('a separator after the notes does not survive', () => {
    // The separator search only takes what precedes the first note, so this
    // one survives to container pruning, which is what stops it importing as
    // a thematic break.
    const html =
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a> t.</p>' +
      '<div class="footnotes"><ol><li id="fn1"><p>The note.' +
      '<a href="#fnref1" class="footnote-back">&#8617;</a></p></li></ol><hr /></div>'
    expect(importAsWord(html)).toBe('Body[^1] t.\n\n[^1]: The note.\n')
  })

  it('notes written before the body still pair, and stay before it', () => {
    // POSITION IS MEANING. The notes are consumed into definitions and the
    // renderer rebuilds the section, which without a marker lands at DOCUMENT
    // END - the same characters in the wrong order, silently. Carve HAS a
    // spelling for the position, so the placement directive goes back where the
    // section sat and the re-render puts the notes first again (carve#1608).
    const html =
      '<html><body>' +
      '<section class="footnotes"><ol><li id="fn1"><p>The note.' +
      '<a href="#fnref1" class="footnote-back">&#8617;</a></p></li></ol></section>' +
      '<p>Body<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a> tail.</p>' +
      '</body></html>'
    const imported = importAsWord(html)

    expect(imported).toBe('::: footnotes\n\n:::\n\nBody[^1] tail.\n\n[^1]: The note.\n')
    expect(carveToHtml(imported).indexOf('The note.')).toBeLessThan(
      carveToHtml(imported).indexOf('Body'),
    )
  })
})
