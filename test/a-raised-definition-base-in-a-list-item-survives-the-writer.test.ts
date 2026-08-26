import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * `markup-carve/carve-js#1519`: a 351-document writer sweep - nine hosts by
 * thirteen definition-list payloads by three authored columns - left six
 * documents failing both of PART 11 §1's weaker properties, `toHtml(fmt(x)) ==
 * toHtml(x)` and idempotence. All six are ONE shape: a definition list raised
 * past a LIST-ITEM-shaped host's content column, whose description holds a block
 * payload written with NO blank line above it.
 *
 * `carve-js#1520` gave the raise to a footnote body and a definition
 * description and withheld it from a list item, on the reading that a list
 * item's two spellings are one document. That holds in the executable spec and
 * NOT in this engine's reader: measured at `10a1698e`, `- intro` with the entry
 * at the item's content column reads the payload as a sibling of the `<dl>`,
 * and the same entry one column in reads it as description content. Two
 * spellings, two documents - so the canonical form has to keep the one the
 * author wrote.
 *
 * TWO EDITS EACH CHANGED THE PARSE, and either alone still failed:
 *
 *  - the raise was dropped, putting the entry back at the item's content
 *    column, where the payload leaves the `dd`;
 *  - a blank line was written above the payload, and at a raised base a blank
 *    ends the description, which loses the payload the raise was applied to
 *    keep.
 *
 * The raise stays self-limiting: `atARaisedBase` applies it only where the
 * parser's own rebase pass would move a line, so every payload that already
 * round-tripped keeps the canonical bytes PART 11 §2 pins. The document and
 * block-quote hosts are the controls for that.
 */

const norm = (h: string): string => h.replace(/\s+/g, ' ').replace(/>\s</g, '><').trim()

/** Both of PART 11 §1's weaker properties, on one document. */
const roundTrips = (src: string): { html: boolean; idempotent: boolean } => {
  const written = carveToCarve(src)
  return {
    html: norm(carveToHtml(src)) === norm(carveToHtml(written)),
    idempotent: written === carveToCarve(written),
  }
}

/**
 * The six sweep documents that failed. Three list-item-shaped hosts, each at
 * one and two columns past its content column.
 */
const FAILING: Array<[string, string]> = [
  ['a bullet item, one column past', '- intro\n\n   :: t\n   :  d\n      > q\n'],
  ['a bullet item, two columns past', '- intro\n\n    :: t\n    :  d\n       > q\n'],
  ['an ordered item, one column past', '10. intro\n\n     :: t\n     :  d\n        > q\n'],
  ['an ordered item, two columns past', '10. intro\n\n      :: t\n      :  d\n         > q\n'],
  ['a nested item, one column past', '- a\n\n  - intro\n\n     :: t\n     :  d\n        > q\n'],
  ['a nested item, two columns past', '- a\n\n  - intro\n\n      :: t\n      :  d\n         > q\n'],
]

describe('a raised definition base in a list item survives the writer', () => {
  for (const [name, src] of FAILING) {
    it(`round-trips a raised entry in ${name}`, () => {
      expect(roundTrips(src)).toEqual({ html: true, idempotent: true })
    })
  }

  /**
   * The payload has to still be DESCRIPTION content after the round trip, not
   * merely render something. Asserted on the written bytes as well as the HTML,
   * because a writer that dropped the payload entirely would satisfy neither
   * property's weaker half on its own.
   */
  it('keeps the payload inside the description through the writer', () => {
    const src = '- intro\n\n   :: t\n   :  d\n      > q\n'
    const written = carveToCarve(src)
    expect(norm(carveToHtml(src))).toMatch(/<dd[^>]*>(?:(?!<\/dd>).)*<blockquote/)
    expect(norm(carveToHtml(written))).toMatch(/<dd[^>]*>(?:(?!<\/dd>).)*<blockquote/)
    expect(written).toBe('- intro\n  :: t\n  : d\n\n    > q\n')
  })

  /**
   * THE RAISE MUST NOT REACH A HOST THAT IS NOT REACHED BY A COLUMN. A
   * block quote carries a marker and the document carries nothing, so neither
   * entry moves and neither blank is dropped - these are the canonical bytes
   * PART 11 §2 pins, and they are what a raise applied too widely would change.
   */
  const CANONICAL: Array<[string, string, string]> = [
    ['the document, payload with a blank', ':: t\n:  d\n\n   > q\n', ':: t\n: d\n\n  > q\n'],
    ['the document, payload with no blank', ':: t\n:  d\n   > q\n', ':: t\n: d\n\n  > q\n'],
    [
      'a block quote',
      '> :: t\n> :  d\n>\n>    > q\n',
      '> :: t\n> : d\n>\n>   > q\n',
    ],
    [
      'a list item whose payload never needed a raise',
      '- intro\n\n   :: t\n   :  d\n\n      more\n',
      '- intro\n  :: t\n  : d\n\n    more\n',
    ],
    [
      'a list item with two entries',
      '- intro\n\n   :: t\n   :  d\n   :: u\n   :  e\n',
      '- intro\n  :: t\n  : d\n  :: u\n  : e\n',
    ],
  ]

  for (const [name, src, expected] of CANONICAL) {
    it(`writes ${name} unchanged`, () => {
      expect(carveToCarve(src)).toBe(expected)
      expect(roundTrips(src)).toEqual({ html: true, idempotent: true })
    })
  }

  /**
   * A BLANK ABOVE ORDINARY PAYLOAD TEXT IS A PARAGRAPH BREAK, and dropping it
   * merges two paragraphs of a `<dd>` - the same class of loss the raise exists
   * to prevent. It is reachable whenever ANY ONE entry of a multi-entry list
   * asks for the raise, because the raise is applied to the whole rendered
   * list: here `b`'s quote is what triggers it and `a`'s paragraph break is
   * what a blanket drop would take. Raised by codex review.
   */
  it('keeps a paragraph break in a sibling description of a raised list', () => {
    const src = '- intro\n\n   :: a\n   : first\n\n     second\n   :: b\n   : d\n     > q\n'
    expect(carveToCarve(src)).toBe('- intro\n  :: a\n  : first\n\n    second\n  :: b\n  : d\n\n    > q\n')
    expect(roundTrips(src)).toEqual({ html: true, idempotent: true })
    expect(norm(carveToHtml(src))).toContain('<dd><p>first</p><p>second</p></dd>')
  })

  /**
   * A BLANK BETWEEN TWO ENTRIES IS NOT A PAYLOAD BLANK. The blank-dropping arm
   * looks at what follows the blank: payload is indented past the entry column,
   * a sibling entry is not. Dropping the wrong one would merge two terms onto
   * one description, which `carve#1636` records as the failure that changes
   * what a surviving term MEANS.
   *
   * The narrower condition is DEFENSIVE rather than load-bearing today:
   * `renderDefinitionList` already removes a blank written between two entries
   * before this arm ever sees one, so widening the condition to every blank
   * fails nothing here. It is written narrow anyway because the arm's job is to
   * drop a PAYLOAD blank, and the entry blank is the one shape whose loss
   * carve#1636 says is unrecoverable.
   */
  it('keeps two entries separate through a raised round trip', () => {
    const src = '- intro\n\n   :: t\n   :  d\n      > q\n   :: u\n   :  e\n'
    const written = carveToCarve(src)
    expect(norm(carveToHtml(written))).toBe(norm(carveToHtml(src)))
    expect(norm(carveToHtml(written))).toContain('<dt>u</dt>')
  })
})
