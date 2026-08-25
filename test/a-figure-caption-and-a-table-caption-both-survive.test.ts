import { describe, expect, it } from 'vitest'

import { carveToHtml, htmlToCarve } from '../src/index.js'

/**
 * TWO CAPTIONS AND ONE SLOT (ruling markup-carve/carve-js#1488).
 *
 * A `<figure>` around a `<table>` that carries its own `<caption>` arrives with
 * two captions, and Carve has exactly one `^ ` line to spell them with: on a
 * table the caret becomes the table's OWN `<caption>`, so the wrapper has
 * nothing left to carry the `<figcaption>` with.
 *
 * BOTH ENGINES WERE WRONG, IN OPPOSITE DIRECTIONS. This one took a
 * `table-degraded` arm and threw the `<figcaption>` away - along with the
 * figure's `id`, silently, which is the drop markup-carve/carve#1721 had just
 * removed for every other figure. carve-php and carve-rs wrote both `^ ` lines,
 * and the second re-read as a literal paragraph, so the document came back
 * holding a `^` its author never typed.
 *
 * THE ASSERTIONS ARE ON THE RE-RENDER, not on the emitted source. A test
 * pinning output bytes passes an implementation that trades one corruption for
 * another, and that exact half-fix has appeared repeatedly in this family. What
 * the ruling actually claims is a property of the document that comes back:
 * both authored strings are in it, and no caret is.
 */
describe('a figure caption and a table caption both survive the import', () => {
  const html =
    '<figure id="f"><table><caption>TableCap</caption><tr><td>a</td></tr></table>' +
    '<figcaption>FigCap</figcaption></figure>'

  const reread = (mode: 'roundtrip' | 'safe' | 'semantic') =>
    carveToHtml(htmlToCarve(html, { mode }).value)

  for (const mode of ['roundtrip', 'safe', 'semantic'] as const) {
    it(`keeps both caption texts in ${mode}`, () => {
      const rendered = reread(mode)
      expect(rendered).toContain('TableCap')
      // The half this engine used to drop.
      expect(rendered).toContain('FigCap')
    })

    it(`invents no caret in ${mode}`, () => {
      // The half carve-php and carve-rs used to add. A `^` reaching rendered
      // text is the document saying something its author did not.
      expect(reread(mode)).not.toContain('^')
    })
  }

  /*
   * `roundtrip` PRESERVES AND THE OTHER TWO DO NOT (markup-carve/carve#1704):
   * rebuild where a Carve spelling reproduces the element, preserve where none
   * does. Two captions and one slot means none does, so the mode whose job is
   * fidelity keeps the bytes and the lossy modes take the declared loss.
   */
  it('raw-preserves the whole figure in roundtrip, byte for byte', () => {
    const result = htmlToCarve(html, { mode: 'roundtrip' })
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['raw-preserved'])
    const rendered = carveToHtml(result.value)
    expect(rendered).toContain('<figcaption>FigCap</figcaption>')
    expect(rendered).toContain('<caption>TableCap</caption>')
    expect(rendered).toContain('id="f"')
  })

  for (const mode of ['safe', 'semantic'] as const) {
    it(`rebuilds rather than preserves in ${mode}`, () => {
      const result = htmlToCarve(html, { mode })
      expect(result.value).not.toContain('=html')
      expect(result.report.diagnostics.map((d) => d.code)).not.toContain('raw-preserved')
      // The table keeps the caption slot and the figcaption's words follow as
      // prose: the ROLE is what the lossy modes spend, not the text.
      expect(result.value).toBe('{#f}\n| a |\n^ TableCap\n\nFigCap\n')
      expect(carveToHtml(result.value)).toContain('<p>FigCap</p>')
    })

    it(`declares the lost caption role once, naming the figcaption, in ${mode}`, () => {
      const diagnostics = htmlToCarve(html, { mode }).report.diagnostics
      // NOT `table-degraded`, which says a table was degraded and nothing about
      // where a caption went, and NOT `structure-unspellable`, which is the row
      // for the wrapper that disappears when a figure around a table is BUILT.
      expect(diagnostics.map((d) => d.code)).toEqual(['element-unwrapped'])
      expect(diagnostics[0]!.message).toContain('<figcaption>')
      expect(diagnostics[0]!.path).toBe('/figure[1]/figcaption[2]')
    })

    it(`carries the figure's id onto the table in ${mode}`, () => {
      // Dropping `#f` in silence is the defect markup-carve/carve#1721 removed
      // for every other figure; this arm was still doing it.
      expect(carveToHtml(htmlToCarve(html, { mode }).value)).toContain('<table id="f">')
    })

    it(`declares the collision when the table sets the same name in ${mode}`, () => {
      const colliding =
        '<figure id="f"><table id="t"><caption>TableCap</caption><tr><td>a</td></tr></table>' +
        '<figcaption>FigCap</figcaption></figure>'
      const result = htmlToCarve(colliding, { mode })
      // The target's value wins the single `id` slot, as it does for a rebuilt
      // figure, and the side that loses is declared rather than resolved in
      // silence.
      expect(carveToHtml(result.value)).toContain('<table id="t">')
      expect(
        result.report.diagnostics.filter((d) => d.code === 'attribute-dropped').map((d) => d.message),
      ).toEqual([
        'Dropped one id on <figure>: the figure and its target both set id, and their two attribute lines merge into a single value',
      ])
    })
  }

  /*
   * THE CONTROL. A figure around a table with NO caption of its own is not in
   * this ruling at all: there is one caption for one slot, the figure's caret
   * lands on the table, and nothing changes. Without this the fix could satisfy
   * every assertion above by routing all figure-wrapped tables through the new
   * arm.
   */
  it('leaves an uncaptioned table wrapped in a captioned figure alone', () => {
    const control = '<figure id="f"><table><tr><td>a</td></tr></table><figcaption>Cap</figcaption></figure>'
    for (const mode of ['roundtrip', 'safe', 'semantic'] as const) {
      const result = htmlToCarve(control, { mode })
      expect(result.value).toBe('{#f}\n| a |\n^ Cap\n')
      expect(result.report.diagnostics.map((d) => d.code)).toEqual(['structure-unspellable'])
      expect(carveToHtml(result.value)).toContain('<caption>Cap</caption>')
    }
  })

  /*
   * A CAPTION THAT SPELLS NOTHING IS NOT A CAPTION (markup-carve/carve-js#1423),
   * so neither empty shape is in the collision - and each falls a different way.
   */
  it('lets the figure caption take a slot an empty table caption never filled', () => {
    const emptyTableCaption =
      '<figure id="f"><table><caption></caption><tr><td>a</td></tr></table><figcaption>Cap</figcaption></figure>'
    for (const mode of ['roundtrip', 'safe', 'semantic'] as const) {
      const result = htmlToCarve(emptyTableCaption, { mode })
      // Carrying the empty caption through wrote a bare `^` from the table and
      // a second one from the figure, so one authored caption came back as two
      // literal carets.
      expect(result.value).toBe('{#f}\n| a |\n^ Cap\n')
      expect(carveToHtml(result.value)).not.toContain('^')
    }
  })

  it('unwraps rather than detaches when the figcaption spells nothing', () => {
    const emptyFigcaption =
      '<figure id="f"><table><caption>TableCap</caption><tr><td>a</td></tr></table><figcaption></figcaption></figure>'
    for (const mode of ['roundtrip', 'safe', 'semantic'] as const) {
      const result = htmlToCarve(emptyFigcaption, { mode })
      // There is no second caption to keep, so nothing is detached and nothing
      // is preserved: a figure with no caption is not a figure at all.
      expect(result.value).toBe('| a |\n^ TableCap\n')
      expect(result.report.diagnostics.map((d) => d.code)).toEqual([
        'element-unwrapped',
        'attribute-dropped',
      ])
      expect(carveToHtml(result.value)).not.toContain('^')
    }
  })

  it('leaves the slot free when the table caption writes nothing', () => {
    // A `<caption>` holding only an empty `<span>` is structurally non-empty
    // and contributes no caption line, so the figure's caption takes the slot
    // as it does for a `<caption></caption>`. carve-php writes this byte for
    // byte, in all three modes.
    const html =
      '<figure id="f"><table><caption><span></span></caption><tr><td>a</td></tr></table>' +
      '<figcaption>FigCap</figcaption></figure>'
    for (const mode of ['safe', 'semantic'] as const) {
      expect(htmlToCarve(html, { mode }).value).toBe('{#f}\n| a |\n^ FigCap\n')
      expect(carveToHtml(htmlToCarve(html, { mode }).value)).toContain('<caption>FigCap</caption>')
    }
  })

  it('writes the detached caption directly after the table it captioned', () => {
    // A figure's caption stays with its TARGET, so a body block the figure also
    // held follows both. Appending it to the end put that block between the
    // table and its own caption, and the row promises a paragraph after the
    // table.
    const withBody =
      '<figure id="f"><table><caption>T</caption><tr><td>a</td></tr></table>' +
      '<figcaption>Cap</figcaption><p>Next</p></figure>'
    expect(htmlToCarve(withBody, { mode: 'safe' }).value).toBe('{#f}\n| a |\n^ T\n\nCap\n\nNext\n')
  })

  /*
   * THE TABLE IS THE ONLY TARGET IN THE COLLISION. A quote, a code block and an
   * image have no caption of their own, so the figure's `^ ` line is
   * uncontested on all three - and a swept check is what says so, rather than a
   * reading of the element list that goes stale the day a target is added.
   */
  it('leaves every other figure target uncontested', () => {
    const targets = [
      '<blockquote><p>q</p></blockquote>',
      '<pre><code>x</code></pre>',
      '<img src="a.png" alt="a">',
    ]
    for (const target of targets) {
      const result = htmlToCarve(`<figure id="f">${target}<figcaption>FigCap</figcaption></figure>`)
      expect(result.report.diagnostics).toEqual([])
      expect(carveToHtml(result.value)).toContain('<figcaption>FigCap</figcaption>')
    }
  })
})
