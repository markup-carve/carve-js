import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * The continuation marker attaches only a block at document column 0.
 * Comments can retain description and footnote bodies below their columns,
 * so those hosts need separate expectations for the two spellings.
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
  for (const [what, src] of BAND.slice(4)) {
    it(`reaches no further than a comment does in ${what}`, () => {
      expect(html(marker(src))).toBe(what.startsWith('a block quote')
        ? '<blockquote><p>intro</p></blockquote><p>+ more</p>'
        : '<ul><li>intro + more</li></ul>')
    })
  }

  for (const [what, src] of BAND.slice(0, 4)) {
    it(`leaves indented text outside ${what}, while a comment retains it`, () => {
      const footnote = what.startsWith('a footnote')
      const reference = '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'
      const notes = '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">'
      const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'
      expect(html(marker(src))).toBe(footnote
        ? '<p>+ more</p>' + reference + notes + '<p>intro' + backlink + '</p></li></ol></section>'
        : '<dl><dt>term</dt><dd>intro + more</dd></dl>')
      expect(html(comment(src))).toBe(footnote
        ? reference + notes + '<p>intro</p><p>more' + backlink + '</p></li></ol></section>'
        : '<dl><dt>term</dt><dd><p>intro</p><p>more</p></dd></dl>')
    })
  }

  it('the quote agrees with its blank-line control too', () => {
    const src = '> intro\n>\n@\n  more\n'
    expect(html(marker(src))).toBe('<blockquote><p>intro</p></blockquote><p>+ more</p>')
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
