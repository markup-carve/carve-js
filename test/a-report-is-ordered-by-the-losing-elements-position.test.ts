import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

/*
 * A DIAGNOSTIC LIST IS ORDERED BY THE LOSING ELEMENT'S DOCUMENT POSITION
 * (docs/html-import.md, "Result and diagnostics"; markup-carve/carve#1586).
 *
 * The page always said the list is ordered and, until that ticket, never said
 * ordered by what - so this importer's list came out in the order its own walk
 * happened to construct the rows in, which is not the order the losses stand in
 * the document. Four shapes below, each one a place where the walk reaches a
 * later element first. carve-php already answered in document order; this is
 * carve-js coming to the same rule.
 *
 * The basis is the position of the LOSING ELEMENT, and the tests are written to
 * separate that from the two things it is easy to confuse it with: the moment
 * the diagnostic was constructed (the footnote case, where the definition is
 * imported before the body it is referenced from) and the traversal order of
 * the shape the importer reads the parent through (the other three, where the
 * parent's children are read in an order the parent's model imposes).
 */
const paths = (html: string): string[] =>
  htmlToCarve(html).report.diagnostics.map((diagnostic) => diagnostic.path ?? '')

describe('a report is ordered by the losing element position', () => {
  it('puts a table caption before a cell below it', () => {
    // The shape markup-carve/carve#1586 was filed on. `table()` fills the
    // caption slot on the FINISHED table, so the cells are read first.
    expect(
      paths(`<table>
<caption onclick="x()">C</caption>
<tr><td onclick="y()">a</td></tr>
</table>
`),
    ).toEqual(['/table[1]/caption[2]', '/table[1]/tr[1]/td[1]'])
  })

  it('puts a list item before a stray element written after it', () => {
    // A non-`li` child is emitted as blocks AHEAD of the list, so the walk
    // reports it before any item - including the items written above it.
    expect(
      paths(`<ul>
<li onclick="x()">a</li>
<div onclick="y()">stray</div>
</ul>
`),
    ).toEqual(['/ul[1]/li[1]', '/ul[1]/div[4]', '/ul[1]/div[4]'])
  })

  it('puts a figcaption before the target written after it', () => {
    // `figure()` lifts the caption out and builds the target first.
    expect(
      paths(`<figure>
<figcaption onclick="x()">C</figcaption>
<blockquote onclick="y()"><p>q</p></blockquote>
</figure>
`),
    ).toEqual(['/figure[1]/figcaption[2]', '/figure[1]/blockquote[4]'])
  })

  it('puts the body before a footnote definition the adapter pass imported first', () => {
    // THE CASE THAT SEPARATES THE BASIS FROM CONSTRUCTION ORDER. The endnotes
    // section is rewritten and its definitions imported before the body walk
    // starts, so the note's row is BUILT first and belongs LAST.
    expect(
      paths(`<p onclick="a()">body<a href="#fn1" role="doc-noteref" id="r1">1</a></p>
<section role="doc-endnotes">
<ol><li id="fn1"><p onclick="b()">note</p></li></ol>
</section>
`),
    ).toEqual(['/p[1]', 'footnote[1]/p[1]'])
  })

  it('keeps two losses on one element in the order the element spells them', () => {
    // Same position, so the tie is broken by construction order, which for one
    // element's attributes is the order they are written in.
    expect(
      htmlToCarve('<p onclick="x()" onmouseover="y()">a</p>').report.diagnostics.map(
        (diagnostic) => diagnostic.message,
      ),
    ).toEqual([
      'Dropped event-handler attribute onclick on <p>',
      'Dropped event-handler attribute onmouseover on <p>',
    ])
  })
})
