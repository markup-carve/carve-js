import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve, parse } from '../src/index.js'

/**
 * Three shapes an HTML import came back from meaning something the HTML never
 * said (markup-carve/carve#1601, minimized in markup-carve/carve#1608, filed as
 * markup-carve/carve-js#1380).
 *
 * They are here together because they are one FAILURE, reached three ways: an
 * import that is green on both of its exits and still changes the document. The
 * caption-caret member of the same family is already fixed and is pinned by the
 * shared fixtures.
 */
describe('an import keeps the meaning the HTML held', () => {
  /**
   * PART 11 §2. A span and an inline link both write their content in a bracket
   * run, and `[^x]` is a note reference - so content opening with a caret comes
   * back as a reference to a note instead of as the thing that was written.
   */
  describe('a bracket run whose content opens a note reference', () => {
    it('escapes the caret, and the input renders back exactly', () => {
      const html = '<p><abbr title="y">^1</abbr></p>'
      expect(htmlToCarve(html).value).toBe('[\\^1]{abbr=y}\n')
      expect(carveToHtml(htmlToCarve(html).value).trim()).toBe('<p><abbr title="y">^1</abbr></p>')
    })

    it('covers the plain span and the anchor, which lose the same way', () => {
      // The reported shape was a semantic span, but the slot is the bracket run
      // rather than the element: an anchor writes `[text](dest)` and loses its
      // DESTINATION to the same collision.
      expect(htmlToCarve('<p><span class="c">^1</span></p>').value).toBe('[\\^1]{.c}\n')
      expect(carveToHtml('[\\^1]{.c}\n').trim()).toBe('<p><span class="c">^1</span></p>')

      expect(htmlToCarve('<p><a href="u">^1</a></p>').value).toBe('[\\^1](u)\n')
      expect(carveToHtml('[\\^1](u)\n').trim()).toBe('<p><a href="u">^1</a></p>')
    })

    it('writes NO escape where a note reference cannot be read', () => {
      // The "only if" half of §2, and the half that is wrong silently: an idle
      // escape passes every gate aimed at the missing one.
      //
      // A reference needs at least one character after the caret and cannot
      // cross `]`, so `[^]` is not one.
      expect(htmlToCarve('<p><abbr title="y">^</abbr></p>').value).toBe('[^]{abbr=y}\n')
      // A caret anywhere but the first position is ordinary punctuation.
      expect(htmlToCarve('<p><abbr title="y">a^1</abbr></p>').value).toBe('[a^1]{abbr=y}\n')
      // An IMAGE label is not this slot at all - the `!` takes the `[` first,
      // so `![^1](u)` is an image whose alternative text is `^1`.
      expect(carveToHtml('![^1](u)\n').trim()).toBe('<img src="u" alt="^1">')
    })

    it("writes no escape inside an inline note, whose content recognizes no note", () => {
      // Corpus `309-a-note-s-content-recognizes-no-note-4` is exactly this, and
      // the repository's idle-escape ratchet fails on it if the escape is
      // written unconditionally. The bracket run there IS a span already.
      const source = 'x ^[a [^1]{.k} c]\n\n[^1]: n\n'
      expect(carveToCarve(source)).toBe(source)
      expect(carveToHtml(source)).toContain('<span class="k">^1</span>')
    })
  })

  /**
   * A note body may reference another note, and the reference has to be
   * recognized there like anywhere else.
   */
  describe('a note reference inside a note body', () => {
    const html =
      '<p>a <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> b</p>\n' +
      '<section role="doc-endnotes"><ol>\n' +
      '<li id="fn1"><p>see <a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p></li>\n' +
      '<li id="fn2"><p>two</p></li>\n' +
      '</ol></section>'

    it('spells it as a reference rather than by hand', () => {
      // It used to come out as `[{^2^}](#fn2){#fnref2 role=doc-noteref}` - a
      // hand-spelled link, because the body was converted while every LATER
      // note's reference sites were still raw anchors.
      const carve = htmlToCarve(html).value
      expect(carve).toContain('[^1]: see [^2]')
      expect(carve).not.toContain('#fn2')
      expect(carve).not.toContain('doc-noteref')
    })

    it('keeps the note it points at, and the text that note held', () => {
      // The spelling was not the whole damage. Nothing referenced `[^2]` any
      // more, so its definition never rendered and the word `two` left the
      // document entirely.
      const rendered = carveToHtml(htmlToCarve(html).value)
      expect(rendered).toContain('two')
      expect(parse(htmlToCarve(html).value).footnoteDefs).toHaveProperty('2')
    })
  })

  /**
   * An empty `<ins>` or `<del>` has nothing to mark, and Carve spells the pair
   * AROUND its content.
   */
  describe('an empty change-tracking element', () => {
    it('is dropped rather than written as a brace pair', () => {
      // `{++}` is not a construct: it renders as four literal characters the
      // HTML never held. `{--}` is worse than literal - it is the braced en
      // dash, so the import rendered a GLYPH for an element holding nothing.
      expect(htmlToCarve('<p><ins></ins></p>').value).toBe('\n')
      expect(htmlToCarve('<p><del></del></p>').value).toBe('\n')
      expect(htmlToCarve('<p>x<ins></ins>y</p>').value).toBe('xy\n')
    })

    it('reports the drop, because an element left the document', () => {
      const report = htmlToCarve('<p><ins></ins></p>').report
      expect(report.diagnostics.map((row) => row.code)).toEqual(['element-dropped'])
      expect(report.diagnostics[0]?.path).toBe('/p[1]/ins[1]')
    })

    it('leaves a NON-empty one exactly as it was', () => {
      expect(htmlToCarve('<p><ins>a</ins></p>').value).toBe('{+a+}\n')
      expect(htmlToCarve('<p><del>a</del></p>').value).toBe('{-a-}\n')
      expect(htmlToCarve('<p><ins>a</ins></p>').report.diagnostics).toEqual([])
    })
  })
})
