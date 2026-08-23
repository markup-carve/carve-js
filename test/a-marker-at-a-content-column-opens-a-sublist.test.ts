import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A MARKER AT AN ITEM'S CONTENT COLUMN OPENS A SUBLIST, FIRST IN THE ITEM OR NOT
 * (markup-carve/carve#1517, PART 9 §24 C3).
 *
 * "AT content_column: dedented to the body's column 0, a block opener nests and
 * a list marker opens a sublist", and it holds "whether or not a blank line
 * precedes the child". §10 I2 defers to it by name rather than competing with
 * it: "TIGHT NESTED LISTS UNAFFECTED: an indented marker inside an open list
 * ITEM opens a sublist with no blank line - that is §24 C3 (content column), not
 * this relation."
 *
 * It answered that way for the FIRST marker in an item and no other, and by
 * accident. The collector hands everything from the first marker line onward to
 * a separate `parseBlocks`, so that marker met no open paragraph; every later
 * one sat in the same stream and met §10 I2 with one open, and folded. Two
 * documents differing only by a sub-list that had already been closed then
 * disagreed about what their shared last line was - an answer depending on a
 * container that had already ended.
 *
 * THE REPRODUCTION HAS NO TABLE IN IT. The ticket used one, which put a table
 * between the sub-list and the later marker and made the cause look like
 * something about tables. A blank line does it just as well, and isolates it.
 */

const flat = (html: string): string => html.replace(/\n\s*/g, ' ').trim()

describe('a marker at an item content column opens a sublist', () => {
  it('opens one below a paragraph when a sub-list has already closed', () => {
    // THE REPRODUCTION. `- z` is closed by the blank line long before `- s1` is
    // read, so nothing about it is still open - and it used to be what decided
    // the answer.
    expect(flat(carveToHtml('- o\n  - z\n\n  para\n  - s1\n'))).toBe(
      '<ul> <li><p>o</p> <ul> <li>z</li> </ul> <p>para</p> <ul> <li>s1</li> </ul> </li> </ul>',
    )
  })

  it('gives the same answer with no sub-list above it', () => {
    // The other half of the pair: one line shorter, and it always opened a
    // sublist because `- s1` was then the item's FIRST marker.
    expect(flat(carveToHtml('- o\n\n  para\n  - s1\n'))).toBe(
      '<ul> <li><p>o</p> <p>para</p> <ul> <li>s1</li> </ul> </li> </ul>',
    )
  })

  it('opens one below a paragraph a table separated from the sub-list', () => {
    // The ticket's own spelling, kept because it is the one that was reported.
    expect(flat(carveToHtml('- o\n  - z\n  | a |\n  para\n  - s1\n'))).toBe(
      '<ul> <li>o <ul> <li>z</li> </ul> <table> <tbody> <tr><td>a</td></tr> </tbody> </table> para <ul> <li>s1</li> </ul> </li> </ul>',
    )
  })

  it('opens one for an ordered marker too, which §24 C3 calls symmetric', () => {
    expect(flat(carveToHtml('- o\n  - z\n\n  para\n  1. s1\n'))).toBe(
      '<ul> <li><p>o</p> <ul> <li>z</li> </ul> <p>para</p> <ol> <li>s1</li> </ol> </li> </ul>',
    )
  })

  it('opens one for a task marker and for the abutting-attribute form', () => {
    expect(flat(carveToHtml('- o\n  - z\n\n  para\n  - [ ] s1\n'))).toContain('<input')
    expect(flat(carveToHtml('- o\n  - z\n\n  para\n  -{.k} s1\n'))).toContain('class="k"')
  })

  it('leaves column 0 alone, where a marker still folds', () => {
    // The control the whole ruling turns on. §24 C3 is a divergence for the
    // CONTENT column; the top level is §10 I2 and does not move.
    expect(flat(carveToHtml('| a |\npara\n- s1\n'))).toBe(
      '<table> <tbody> <tr><td>a</td></tr> </tbody> </table> <p>para - s1</p>',
    )
  })

  it('leaves a marker BELOW the content column folding', () => {
    // §24 C3's other band, and the reason the test is on the dispatch column
    // rather than on a whitespace-tolerant marker pattern: "BELOW
    // content_column ... a list marker folds as lazy item text".
    expect(flat(carveToHtml('1. outer\n  1. inner\n'))).toBe(
      '<ol> <li>outer 1. inner</li> </ol>',
    )
  })

  it('leaves a marker on a quote lazy continuation as text', () => {
    // carve-js#1200, which is NOT overturned: the quote's open paragraph claims
    // the line before the item's column does. The sublist arm is waived for the
    // quote's own lazy loop precisely so this keeps answering the old way.
    expect(flat(carveToHtml('- > q\n  - s\ntail\n'))).toBe(
      '<ul> <li> <blockquote><p>q - s tail</p></blockquote> </li> </ul>',
    )
  })

  it('still opens one when the quote left no paragraph to fold into', () => {
    // The near miss #1200 names: a quote ending on a heading has nothing open,
    // so the marker reaches the item body and §24 C3 opens the sublist.
    expect(flat(carveToHtml('- > # h\n  - s\n'))).toContain('<ul>')
  })
})
