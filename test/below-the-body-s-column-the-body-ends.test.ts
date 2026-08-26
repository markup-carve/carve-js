import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 7 `definition_indent`, "BELOW THE BODY'S COLUMN THE BODY ENDS --
 * NORMATIVE" (markup-carve/carve#932).
 *
 * EVERY ROW HERE STANDS ONE LINE BELOW THE DESCRIPTION MARKER. A block opener
 * written DIRECTLY under a description line is that description's content at
 * any indent above zero (markup-carve/carve#1769, corpus category 422,
 * markup-carve/carve-js#1518), so the position this band is stated about is
 * the one with something already in the body above it. A `   more`
 * continuation at the body's own column is that something: it is inside the
 * body by the rule these rows are not about, and it moves no column.
 *
 * The two rules meet at the marker line and nowhere else, and
 * `a-recognized-opener-in-a-body-needs-no-blank-line-above-it.test.ts` pins the
 * other side of the seam against these rows.
 */
const body = ':: t\n:  body\n   more\n'
const dd = '<dl>\n  <dt>t</dt>\n  <dd>body\nmore</dd>\n</dl>\n'

describe("BELOW the body's column the body ends", () => {
  it('the BELOW band gives one answer at every sub-column indent', () => {
    // This is the half that moved. Both used to fold the quote into the dd as
    // lazy text. The body ends; the top level's STRICT COLUMN-0 rule for an
    // indented block opener is what then makes it text rather than a quote, and
    // that rule belongs to the surviving context, not to this band.
    let input = body + ' '.repeat(1) + '> q\n'
    const expected = dd + '<p>&gt; q</p>'
    expect(carveToHtml(input)).toBe(expected)

    input = body + ' '.repeat(2) + '> q\n'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('CONTROL column 0 is the ordinary case of the same band', () => {
    // The band does not measure how far below the column a line is, so column 0
    // has to answer by the same rule; it renders differently only because an
    // opener at column 0 really opens at the top level.
    const input = body + ' '.repeat(0) + '> q\n'
    const expected = dd + '<blockquote><p>q</p></blockquote>'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('CONTROL AT the column the opener opens inside the dd', () => {
    const input = body + ' '.repeat(3) + '> q\n'
    const expected =
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body\nmore</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('CONTROL PAST the column a block opener establishes an authored base', () => {
    const expected =
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body\nmore</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>'
    expect(carveToHtml(body + ' '.repeat(4) + '> q\n')).toBe(expected)
    expect(carveToHtml(body + ' '.repeat(5) + '> q\n')).toBe(expected)
  })

  it('a plain line still continues the body lazily at every sub-column indent', () => {
    // Lazy continuation is not the other side of this rule. A plain line carries
    // no block opener at any indent, so it folds into the body's open paragraph
    // exactly as before; a fix that ended the body on every below-column line
    // breaks this row.
    let input = body + ' '.repeat(0) + 'tail\n'
    const expected = '<dl>\n  <dt>t</dt>\n  <dd>body\nmore\ntail</dd>\n</dl>'
    expect(carveToHtml(input)).toBe(expected)

    // The residue does not survive into the rendering: a paragraph
    // continuation line drops its leading whitespace, so all three indents
    // produce the same bytes.
    input = body + ' '.repeat(1) + 'tail\n'
    expect(carveToHtml(input)).toBe(expected)

    input = body + ' '.repeat(2) + 'tail\n'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('every block-opener kind answers the band the same way', () => {
    // The band is stated about the column, not about the construct, so a fix
    // wired to the blockquote pattern alone fails here.
    //
    // The assertion is that the opener LEFT the dd, not merely that one and two
    // spaces agree with each other: before this clause they agreed too, both
    // folding the opener in as lazy text, so an agreement test alone is a
    // control rather than a proof. `</dl>` followed by a block is what moved.
    const band = (n: number, opener: string) => carveToHtml(body + ' '.repeat(n) + opener + '\n')
    for (const opener of ['> q', '# h', '| a |', '---', '::: note']) {
      const left = dd
      expect(band(1, opener).startsWith(left)).toBe(true)
      expect(band(2, opener)).toBe(band(1, opener))
      // CONTROL: at the column the same opener really opens, inside the dd.
      expect(band(3, opener).startsWith(left)).toBe(false)
      expect(band(3, opener)).not.toBe(band(1, opener))
    }
  })

  it('an INVISIBLE line is NOT an opener, so the band folds it', () => {
    // THE BULLET IS ABOUT OPENERS (markup-carve/carve#1809 amended the clause to
    // say so, corpus category 430). This row used to assert the opposite - that
    // `{.x}` and `[a]: /u` left the `dd` like a quote does - and that reading is
    // what §10 I5 now rules out: at a NONZERO column below the content column an
    // invisible line is "lazy paragraph text of THAT container ... and does not
    // register". Ending the body and re-emitting the characters one level out is
    // not carrying that sentence out, whatever the bytes look like.
    //
    // The comment stays in the ejecting column: it is column-exempt (PART 9 §24)
    // and renders nothing at any column, which corpus 430-5 pins.
    const band = (n: number, opener: string) =>
      carveToHtml(body + ' '.repeat(n) + opener + '\npara\n')
    for (const opener of ['{.x}', '[a]: /u']) {
      const folded = `<dl>\n  <dt>t</dt>\n  <dd>body\nmore\n${opener}\npara</dd>\n</dl>`
      expect(band(1, opener)).toBe(folded)
      expect(band(2, opener)).toBe(folded)
    }
    expect(band(1, '%% c')).toBe(dd + '<p>para</p>')
    expect(band(2, '%% c')).toBe(band(1, '%% c'))
    // AND THE FOLD IS A FOLD, not a half one: the attribute attaches nothing and
    // the definition registers nothing, so a later reference stays literal.
    // Characters on the page plus an entry in a symbol table is the shape corpus
    // 430 exists to catch.
    expect(carveToHtml(body + ' [a]: /u\npara\n\nSee [text][a].\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>body\nmore\n[a]: /u\npara</dd>\n</dl>\n<p>See [text][a].</p>',
    )
    // CONTROL at column 0, the document's own opener column: there the attribute
    // really attaches and the definition really registers.
    expect(carveToHtml(body + '{.x}\npara\n')).toBe(dd + '<p class="x">para</p>')
    expect(carveToHtml(body + '[a]: /u\n\nSee [text][a].\n')).toBe(
      dd + '<p>See <a href="/u">text</a>.</p>',
    )
  })
})
