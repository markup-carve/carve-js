import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 7 `definition_indent`, "BELOW THE BODY'S COLUMN THE BODY ENDS --
 * NORMATIVE" (markup-carve/carve#932).
 */
describe("BELOW the body's column the body ends", () => {
  it('the BELOW band gives one answer at every sub-column indent', () => {
    // This is the half that moved. Both used to fold the quote into the dd as
    // lazy text. The body ends; the top level's STRICT COLUMN-0 rule for an
    // indented block opener is what then makes it text rather than a quote, and
    // that rule belongs to the surviving context, not to this band.
    let input = ':: t\n:  body\n' + ' '.repeat(1) + '> q\n'
    let expected = '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n<p>&gt; q</p>'
    expect(carveToHtml(input)).toBe(expected)

    input = ':: t\n:  body\n' + ' '.repeat(2) + '> q\n'
    expected = '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n<p>&gt; q</p>'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('CONTROL column 0 is the ordinary case of the same band', () => {
    // The band does not measure how far below the column a line is, so column 0
    // has to answer by the same rule; it renders differently only because an
    // opener at column 0 really opens at the top level.
    const input = ':: t\n:  body\n' + ' '.repeat(0) + '> q\n'
    const expected =
      '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n<blockquote><p>q</p></blockquote>'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('CONTROL AT the column the opener opens inside the dd', () => {
    const input = ':: t\n:  body\n' + ' '.repeat(3) + '> q\n'
    const expected =
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('CONTROL PAST the column a block opener establishes an authored base', () => {
    let input = ':: t\n:  body\n' + ' '.repeat(4) + '> q\n'
    let expected =
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>'
    expect(carveToHtml(input)).toBe(expected)

    input = ':: t\n:  body\n' + ' '.repeat(5) + '> q\n'
    expected =
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>'
    expect(carveToHtml(input)).toBe(expected)
  })

  it('a plain line still continues the body lazily at every sub-column indent', () => {
    // Lazy continuation is not the other side of this rule. A plain line carries
    // no block opener at any indent, so it folds into the body's open paragraph
    // exactly as before; a fix that ended the body on every below-column line
    // breaks this row.
    let input = ':: t\n:  body\n' + ' '.repeat(0) + 'tail\n'
    let expected = '<dl>\n  <dt>t</dt>\n  <dd>body\ntail</dd>\n</dl>'
    expect(carveToHtml(input)).toBe(expected)

    // The residue does not survive into the rendering: a paragraph
    // continuation line drops its leading whitespace, so all three indents
    // produce the same bytes.
    input = ':: t\n:  body\n' + ' '.repeat(1) + 'tail\n'
    expect(carveToHtml(input)).toBe(expected)

    input = ':: t\n:  body\n' + ' '.repeat(2) + 'tail\n'
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
    const band = (n: number, opener: string) =>
      carveToHtml(':: t\n:  body\n' + ' '.repeat(n) + opener + '\n')
    for (const opener of ['> q', '# h', '| a |', '---', '::: note']) {
      const left = '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n'
      expect(band(1, opener).startsWith(left)).toBe(true)
      expect(band(2, opener)).toBe(band(1, opener))
      // CONTROL: at the column the same opener really opens, inside the dd.
      expect(band(3, opener).startsWith(left)).toBe(false)
      expect(band(3, opener)).not.toBe(band(1, opener))
    }
  })

  it('an INVISIBLE opener answers the band too', () => {
    // Raised by codex review. `startsInterruptingBlock` is a battery of tests on
    // one string, except for the block-attribute arm, which re-reads the line
    // from the lexer - so the content override reached every opener kind but
    // that one, and a below-column `{.x}` stayed lazy text while a below-column
    // `> q` left the container. One arm answering a different question than the
    // other twelve is how a rule acquires a second reading.
    const band = (n: number, opener: string) =>
      carveToHtml(':: t\n:  body\n' + ' '.repeat(n) + opener + '\npara\n')
    const left = '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n'
    for (const opener of ['{.x}', '[a]: /u', '%% c']) {
      expect(band(1, opener).startsWith(left)).toBe(true)
      expect(band(2, opener)).toBe(band(1, opener))
    }
    // The whole document for the attribute case, so the row says what it means:
    // the block attribute did NOT attach to `para`, because the body ended and
    // the top level's own strict column-0 rule then made the line text.
    expect(carveToHtml(':: t\n:  body\n {.x}\npara\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n<p>{.x}\npara</p>',
    )
    // CONTROL at column 0, where the attribute really attaches.
    expect(carveToHtml(':: t\n:  body\n{.x}\npara\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n<p class="x">para</p>',
    )
  })
})
