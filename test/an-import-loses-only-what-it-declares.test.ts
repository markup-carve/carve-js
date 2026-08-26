import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve } from '../src/index.js'

/*
 * Two import shapes ruled on markup-carve/carve#1608, and one rule behind them:
 * A DECLARED LOSS IS A CEILING, NOT A LICENCE. An importer may lose what it
 * declares and no more.
 *
 * 1. AN EMPTY <dd> was written as a bare colon line, which the parser reads as
 *    more of the TERM above it. So the description was lost AND the term was
 *    damaged - twice the declared loss. Six other spellings were probed on the
 *    ruling and none works. Writing the term alone loses exactly the empty
 *    description, which is what `structure-unspellable` on the `<dd>` declares.
 *
 * 2. AN ENDNOTES SECTION THAT IS NOT LAST was silently moved to the end: the
 *    notes are consumed into definitions and the renderer rebuilds the section
 *    at document end. Same characters, wrong order, no diagnostic. This is NOT
 *    `structure-unspellable` - Carve HAS a spelling for the position, the
 *    `::: footnotes` placement directive - so discarding a position the
 *    language can express is a loss with no justification.
 *
 * Both keep their structure on the AST-returning exit, which is what
 * `structure-unspellable` means: the structure survives in the AST and not in
 * written Carve.
 */

const EMPTY_DD = '<dl><dt>term</dt><dd></dd></dl>'
const ENDNOTES_NOT_LAST =
  '<p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes"><ol><li id="fn1"><p>n</p></li></ol></section>\n' +
  '<p>after</p>'
const ENDNOTES_LAST =
  '<p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes"><ol><li id="fn1"><p>n</p></li></ol></section>'

describe('an empty definition description', () => {
  it('is written with the {empty} sentinel', () => {
    expect(htmlToCarve(EMPTY_DD).value).toBe(':: term\n: {empty}\n')
  })

  it('reads back as the same list, term and empty description alike', () => {
    expect(carveToHtml(htmlToCarve(EMPTY_DD).value)).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd></dd>\n</dl>',
    )
  })

  it('declares no loss, because it takes none', () => {
    // The sentinel spells the shape, so there is nothing for the ceiling to
    // permit (markup-carve/carve#1827).
    expect(htmlToCarve(EMPTY_DD).report.diagnostics).toEqual([])
  })

  it('keeps the empty description on the AST exit too', () => {
    const { value, report } = htmlToAst(EMPTY_DD)

    expect(report.diagnostics).toEqual([])
    expect(JSON.stringify(value)).toContain('"definitions":[[]]')
  })

  it('leaves a description that writes something alone', () => {
    // The control. Every assertion above passes for an importer that wrote
    // `: {empty}` for EVERY description, and this is what such an importer
    // would break.
    expect(htmlToCarve('<dl><dt>term</dt><dd>d</dd></dl>').value).toBe(':: term\n: d\n')
    expect(carveToHtml(htmlToCarve('<dl><dt>term</dt><dd>d</dd></dl>').value)).toContain('<dd>d</dd>')
  })
})

describe('an endnotes section that is not last', () => {
  it('writes the placement directive where the section sat', () => {
    expect(htmlToCarve(ENDNOTES_NOT_LAST).value).toBe(
      'a[^1]\n\n::: footnotes\n\n:::\n\nafter\n\n[^1]: n\n',
    )
  })

  it('renders the input back in the right order', () => {
    // The point of the directive, stated as the property rather than as bytes.
    const html = carveToHtml(htmlToCarve(ENDNOTES_NOT_LAST).value)

    expect(html.indexOf('doc-endnotes')).toBeLessThan(html.indexOf('after'))
  })

  it('puts the placement node in the same slot on the AST exit', () => {
    const { value } = htmlToAst(ENDNOTES_NOT_LAST)
    const kinds = value.children.map((child) => child.type)

    expect(kinds).toEqual(['paragraph', 'admonition', 'paragraph'])
  })

  it('says nothing, because nothing is lost', () => {
    // Not `structure-unspellable`: the position IS spellable, so the answer is
    // to spell it, and a diagnostic here would report a loss that no longer
    // happens.
    expect(htmlToCarve(ENDNOTES_NOT_LAST).report.diagnostics).toEqual([])
  })

  it('writes no directive when the section IS last', () => {
    // The control, and the compatibility half: the renderer already appends the
    // section at document end, so a document that was right stays byte-identical.
    expect(htmlToCarve(ENDNOTES_LAST).value).toBe('a[^1]\n\n[^1]: n\n')
  })

  it('writes no directive for a document with no endnotes section at all', () => {
    // The other control: nothing was pruned, so nothing is marked.
    expect(htmlToCarve('<p>a</p>\n<p>b</p>').value).toBe('a\n\nb\n')
  })

  it('looks past the immediate siblings for what follows', () => {
    // A section last inside a wrapper is still not last in the document, and an
    // importer that only checked the siblings beside it would call this final.
    const html =
      '<div><p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>' +
      '<section role="doc-endnotes"><ol><li id="fn1"><p>n</p></li></ol></section></div>' +
      '<p>after</p>'

    expect(htmlToCarve(html).value).toContain('::: footnotes')
  })
})
