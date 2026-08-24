/*
 * `roundtrip` rebuilds a figure when a Carve spelling reproduces the element,
 * preserves the element when none does, and never loses anything silently
 * (markup-carve/carve#1704).
 *
 * THE SUBJECT IS A PROPERTY, NOT A LIST OF TARGETS. The seven rows below are
 * the whole measured surface of the family, and each is pinned in both halves -
 * the source written and the report - because a row that pins only the source
 * cannot tell a loss from a declared one. The property test at the end is the
 * one that generalizes: a caption target added later inherits it without
 * needing another sweep of every tag to discover it.
 *
 * THE PARAGRAPH ROW IS THE DEFECT THIS FILE WAS WRITTEN FOR. Before the fix
 * `<figure id="g"><p>x</p><figcaption>Cap</figcaption></figure>` came back as
 * `<p id="g">x ^ Cap</p>`: the figure gone, the caption no longer merely lost
 * but turned into literal prose inside the paragraph, and ZERO diagnostics
 * saying so. The list row lost its figure too and at least warned twice.
 */
import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

const IMAGE = '<figure id="f"><img src="a.png" alt="A"><figcaption>Cap</figcaption></figure>'
const CODE = '<figure id="c"><pre><code>x</code></pre><figcaption>Cap</figcaption></figure>'
const QUOTE = '<figure id="q"><blockquote><p>a</p></blockquote><figcaption>Cap</figcaption></figure>'
const TABLE = '<figure id="t"><table><tr><td>a</td></tr></table><figcaption>Cap</figcaption></figure>'
const LIST = '<figure id="l"><ul><li>a</li></ul><figcaption>Cap</figcaption></figure>'
const PARAGRAPH = '<figure id="g"><p>x</p><figcaption>Cap</figcaption></figure>'
const ORPHAN_CELL = '<td id="x"><h1>H</h1></td>'

const roundtrip = (html: string) => {
  const result = htmlToCarve(html, { mode: 'roundtrip' })
  return { carve: result.value, codes: result.report.diagnostics.map((d) => d.code) }
}

describe('roundtrip rebuilds a figure only when Carve spells it', () => {
  it('rebuilds an image figure, which the caption line re-parses to', () => {
    expect(roundtrip(IMAGE)).toEqual({ carve: '{#f}\n![A](a.png)\n^ Cap\n', codes: [] })
  })

  it('rebuilds a code-block figure', () => {
    expect(roundtrip(CODE)).toEqual({ carve: '{#c}\n```\nx\n```\n^ Cap\n', codes: [] })
  })

  it('rebuilds a blockquote figure', () => {
    expect(roundtrip(QUOTE)).toEqual({ carve: '{#q}\n> a\n^ Cap\n', codes: [] })
  })

  /*
   * THE ONE PLACE THE RULE BENDS, and it bends on purpose. No Carve spelling
   * reproduces `<figure><table>`: the rebuild writes the caption on the TABLE,
   * so it renders `<table id="t"><caption>Cap</caption>` and the wrapper is
   * gone. Strictly this row would preserve the element. It rebuilds anyway,
   * with the `structure-unspellable` row it already had, because
   * `<table><caption>` is the idiomatic HTML for a captioned table and
   * preserving would throw away the `| a |` spelling for a common shape.
   */
  it('rebuilds a table figure, the deliberate carve-out, and says what it cost', () => {
    expect(roundtrip(TABLE)).toEqual({ carve: '{#t}\n| a |\n^ Cap\n', codes: ['structure-unspellable'] })
  })

  it('preserves a list figure, which no Carve spelling reproduces', () => {
    expect(roundtrip(LIST)).toEqual({ carve: '```=html\n' + LIST + '\n```\n', codes: ['raw-preserved'] })
  })

  it('preserves a paragraph figure rather than writing a caret into its prose', () => {
    expect(roundtrip(PARAGRAPH)).toEqual({ carve: '```=html\n' + PARAGRAPH + '\n```\n', codes: ['raw-preserved'] })
  })

  it('preserves an orphan table cell, which Carve cannot spell at all', () => {
    expect(roundtrip(ORPHAN_CELL)).toEqual({
      carve: '`' + ORPHAN_CELL + '`{=html}\n',
      codes: ['raw-preserved', 'raw-preserved'],
    })
  })

  /*
   * THE PROPERTY, STATED WHERE A NEW TARGET WILL TRIP OVER IT. Zero diagnostics
   * is a claim that nothing was lost, so a re-render that no longer holds the
   * caption element makes it a false claim. This is the assertion the paragraph
   * row failed before the fix, and it failed for the right reason: not a changed
   * string, but a caption that left the document with nothing anywhere saying so.
   */
  it.each([
    ['image', IMAGE],
    ['code block', CODE],
    ['blockquote', QUOTE],
    ['table', TABLE],
    ['list', LIST],
    ['paragraph', PARAGRAPH],
  ])('loses nothing silently around a %s', (_name, html) => {
    const { carve, codes } = roundtrip(html)
    const back = carveToHtml(carve)
    const keptTheCaption = /<(fig)?caption[ >]/.test(back)
    expect(keptTheCaption || codes.length > 0).toBe(true)
  })

  /*
   * The mode is what moved, and only the mode. `semantic` is allowed to be
   * lossy - that is the whole distinction between the two - so the paragraph
   * figure still writes the caption line there, and `safe` with it.
   */
  it.each(['safe', 'semantic'] as const)('leaves %s mode alone', (mode) => {
    const result = htmlToCarve(PARAGRAPH, { mode })
    expect(result.value).toBe('{#g}\nx\n^ Cap\n')
  })

  /*
   * A `<figure>` with no caption is not a captioned wrapper at all (PART 9
   * §4b), so it never reaches the rebuild-or-preserve decision: it unwraps with
   * the declared row it always had. Pinned here so the boundary of this ruling
   * is visible from the file that implements it.
   */
  it('leaves a caption-less figure on its existing declared unwrap', () => {
    expect(roundtrip('<figure id="n"><img src="a.png" alt="A"></figure>')).toEqual({
      carve: '![A](a.png)\n',
      codes: ['element-unwrapped', 'attribute-dropped'],
    })
  })
})
