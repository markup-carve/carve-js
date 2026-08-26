import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * THE COLUMN GATE IS ONE OPERATION IN EVERY CONTAINER (PART 9 §17 L3,
 * markup-carve/carve#1814, markup-carve/carve-js#1554).
 *
 * `AND FLUSH-LEFT MEANS COLUMN 0` (§17 L3, markup-carve/carve#1436) says the
 * `+` marker attaches a block that begins at DOCUMENT column 0 and nothing
 * else. A line at any other column is not attached at all: it falls through to
 * the ordinary column rules, which give it to whichever container its own
 * column names, "exactly as if the `+` line had been a comment".
 *
 * That question was asked in the LIST ITEM and nowhere else. The predicate
 * existed, but only the list's three attach paths called it, so a footnote
 * body, a definition description and a block quote each reached out for a line
 * the clause leaves where the author wrote it.
 *
 * THE CLAUSE NAMES ITS OWN CONTROL, so the rule is a RELATION between two
 * documents and no single golden can express it: for every container, the
 * marker spelling and the comment spelling of the same document must render
 * the same thing. A change that fixes three containers and drifts the fourth
 * passes every golden it did not touch.
 *
 * The QUOTE row uses the blank-line control as well. A comment line at column
 * 0 under an OPEN quoted paragraph is folded into it as lazy text rather than
 * being skipped - a defect of the quote's invisible-line handling and not of
 * the marker (markup-carve/carve#1817 left it deliberately) - so the row closes
 * the quoted paragraph with a bare `>` first and asks about the column alone.
 */

// Whitespace before a closing tag is dropped as well as collapsed: a comment
// line inside a list item leaves a trailing space in the item's text where the
// marker leaves none. That is the comment's own layout artifact and says
// nothing about which container the line after it reached, which is the only
// thing these rows ask.
const html = (src: string) =>
  carveToHtml(src).replace(/\s+/g, ' ').replace(/> </g, '><').replace(/ (<\/)/g, '$1').trim()

// The same document twice, `+` where the control has its invisible line.
const marker = (src: string) => src.replace('@', '+')
const comment = (src: string) => src.replace('@', '%% c')

const BAND: Array<[string, string]> = [
  ['a footnote body, below its minimum column', '[^a]: intro\n@\n more\n\nsee[^a]\n'],
  ['a footnote body, at its minimum column', '[^a]: intro\n@\n  more\n\nsee[^a]\n'],
  ['a description, below its content column', ':: term\n:  intro\n@\n  more\n'],
  ['a description, one column further below', ':: term\n:  intro\n@\n more\n'],
  ['a block quote, with the quoted paragraph closed', '> intro\n>\n@\n  more\n'],
  ['a list item, the container that always held the gate', '- intro\n@\n  more\n'],
]

describe("the continuation marker's column gate reaches every container", () => {
  for (const [what, src] of BAND) {
    it(`reaches no further than a comment does in ${what}`, () => {
      expect(html(marker(src))).toBe(html(comment(src)))
    })
  }

  it('the quote agrees with its blank-line control too', () => {
    const src = '> intro\n>\n@\n  more\n'
    expect(html(marker(src))).toBe(html(src.replace('@\n', '')))
  })

  /*
   * The positive half. A gate that refused everything would satisfy every
   * assertion above, so each container is asked the SAME document one column
   * over, where the marker does attach.
   */
  const ATTACHES: Array<[string, string, string]> = [
    ['a footnote body', '[^a]: intro\n+\nmore\n\nsee[^a]\n',
      '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>' +
      '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">' +
      '<p>intro</p><p>more<a href="#fnref1" role="doc-backlink" ' +
      'aria-label="Back to reference">↩</a></p></li></ol></section>'],
    ['a description', ':: term\n:  intro\n+\nmore\n',
      '<dl><dt>term</dt><dd><p>intro</p><p>more</p></dd></dl>'],
    ['a block quote', '> intro\n>\n+\nmore\n',
      '<blockquote><p>intro</p><p>more</p></blockquote>'],
    ['a list item', '- intro\n+\nmore\n', '<ul><li>intro more</li></ul>'],
  ]

  for (const [what, src, expected] of ATTACHES) {
    it(`a column-0 block still attaches in ${what}`, () => {
      expect(html(src)).toBe(expected)
    })
  }
})
