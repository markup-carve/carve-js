import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A LIST MARKER ON A BLOCK QUOTE'S LAZY CONTINUATION IS TEXT (carve-js#1200).
 *
 * `parseBlockQuote` has always read it that way, and says so in its own comment:
 * "a bare list marker is NOT a paragraph interrupter, so it FOLDS into the
 * quoted paragraph as literal text - but ONLY when an open paragraph precedes
 * it". At the top level `> q` / `- s` is one quoted paragraph here already.
 *
 * The LIST ITEM's collector asked a different question, and asked it of the line
 * rather than of what was open: it split the item's stream at the first
 * marker-SHAPED line, so `- > q` / `  - s` ended the quote and opened a sub-list
 * where carve-rs and the executable spec keep the text. It was the same
 * derivation the collector already carried for a code fence, a comment fence and
 * a colon fence (PART 9 §24 S1 and S2 place a line by the COLUMN it reaches and
 * never read its first character, markup-carve/carve#975) - a fourth open thing
 * it did not ask about.
 *
 * So the fix is the rule and not the twelve reported spellings: the marker test
 * consults `insideOpenQuoteParagraph` beside `insideOpenFence`. Every marker
 * dialect folds, because none of them was ever the question.
 *
 * The near miss is the last four tests. A quote that ends on a HEADING, a TABLE
 * or a blank line has no open paragraph, so the marker has nothing to fold into
 * and really does open a sub-list. Those must keep opening one; a fix written
 * against "there is a quote above" rather than "that quote has an open
 * paragraph" breaks exactly them.
 *
 * TWO SPELLINGS OF ONE RULE, IN SERIES, and it is worth knowing which decides.
 * Dropping `blockQuoteParagraphOpen` from the new guard alone changes nothing:
 * the item then keeps its stream whole, and `parseBlockQuote`'s own paragraph
 * guard ends the quote on the heading instead. Dropping that one alone changes
 * nothing either, because the new guard has already split the stream. Dropping
 * BOTH breaks exactly the heading and table tests below - which is what says the
 * conjunct states the rule rather than decorating it.
 *
 * Every expectation is the executable spec's own output for that input, taken
 * from `spec/scripts/spec/layout.mjs` plus `spec/scripts/spec/html.mjs`, and
 * carve-rs answers the same way. They are FULL flattened documents: asserting
 * only that `s` survives passes on the sub-list too, which is the wrong output.
 */

const flat = (html: string): string => html.replace(/\n\s*/g, ' ').trim()

describe('a marker on a block quote lazy continuation is text', () => {
  it('folds a bullet, and the tail below it', () => {
    expect(flat(carveToHtml('- > q\n  - s\ntail\n'))).toBe(
      '<ul> <li> <blockquote><p>q - s tail</p></blockquote> </li> </ul>',
    )
  })

  it('folds a star bullet', () => {
    expect(flat(carveToHtml('* > q\n  * s\n'))).toBe(
      '<ul> <li> <blockquote><p>q * s</p></blockquote> </li> </ul>',
    )
  })

  it('folds an ordered marker at its own content column', () => {
    expect(flat(carveToHtml('1. > q\n   1. s\n\ntail\n'))).toBe(
      '<ol> <li> <blockquote><p>q 1. s</p></blockquote> </li> </ol> <p>tail</p>',
    )
  })

  it('folds a bare-dot marker', () => {
    expect(flat(carveToHtml('. > q\n  . s\n'))).toBe(
      '<ol> <li> <blockquote><p>q . s</p></blockquote> </li> </ol>',
    )
  })

  it('folds a task marker', () => {
    expect(flat(carveToHtml('- > q\n  - [ ] s\n'))).toBe(
      '<ul> <li> <blockquote><p>q - [ ] s</p></blockquote> </li> </ul>',
    )
  })

  it('folds an abutting-attribute marker', () => {
    expect(flat(carveToHtml('- > q\n  -{.k} s\n'))).toBe(
      '<ul> <li> <blockquote><p>q -{.k} s</p></blockquote> </li> </ul>',
    )
  })

  it('folds into a nested quote the item ends on', () => {
    expect(flat(carveToHtml('- > > n\n  - s\n'))).toBe(
      '<ul> <li> <blockquote> <blockquote><p>n - s</p></blockquote> </blockquote> </li> </ul>',
    )
  })

  it('reads the same way with no item around it, as it always did', () => {
    expect(flat(carveToHtml('> q\n- s\n'))).toBe('<blockquote><p>q - s</p></blockquote>')
  })

  it('still opens a sub-list when the quote ends on a heading', () => {
    expect(flat(carveToHtml('- > # h\n  - s\n'))).toBe(
      '<ul> <li> <blockquote> <h1 id="h">h</h1> </blockquote> <ul> <li>s</li> </ul> </li> </ul>',
    )
  })

  it('still opens a sub-list when the quote ends on a table', () => {
    expect(flat(carveToHtml('- > | a |\n  > | - |\n  - s\n'))).toBe(
      '<ul> <li> <blockquote> <table> <thead> <tr><th scope="col">a</th></tr> </thead> </table>' +
        ' </blockquote> <ul> <li>s</li> </ul> </li> </ul>',
    )
  })

  it('still opens a sub-list when a blank line closed the quote', () => {
    expect(flat(carveToHtml('- > q\n\n  - s\n'))).toBe(
      '<ul> <li> <blockquote><p>q</p></blockquote> <ul> <li>s</li> </ul> </li> </ul>',
    )
  })

  it('still opens a sub-list under an ordinary paragraph', () => {
    expect(flat(carveToHtml('- x\n  - s\n'))).toBe(
      '<ul> <li>x <ul> <li>s</li> </ul> </li> </ul>',
    )
  })
})
