import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/html-import.js'
import { renderHtml } from '../src/render-html.js'
import { parse } from '../src/parse.js'
import type { HtmlImportMode } from '../src/html-import.js'

/**
 * A cell's `text-align` and `vertical-align` reach the cell's MARKER RUN in
 * `semantic` and `roundtrip`, and are dropped and reported in `safe`.
 *
 * `style` used to be refused wholesale except for one arm that mapped
 * `text-align` onto the key-value `{align=…}`. Both halves were wrong. The
 * alignment had somewhere faithful to go the whole time - a Carve cell
 * alignment is written back as `style="text-align: right;"`, the very
 * declaration the import was handed - and the key-value is written back as
 * `align="right"`, so `carve -> html -> carve -> html` was not stable: the
 * first render wrote the CSS, the import turned it into the attribute, and the
 * second render wrote the attribute (markup-carve/carve#1741,
 * markup-carve/carve#1745). `vertical-align` has the same answer through the
 * cell's `valign` and was not mapped at all (markup-carve/carve#1746).
 *
 * THE BOUNDARY IS THE POINT, so every side of it is pinned: the mapping
 * happens and survives a full re-render; `safe` still drops and still reports;
 * a property the language genuinely cannot spell still reports, so the change
 * cannot read as a blanket "stop reporting"; and a body cell repeating its
 * column's value writes no run of its own, because the head already says it.
 */
const imported = (html: string, mode: HtmlImportMode): string => htmlToCarve(html, { mode }).value

const codes = (html: string, mode: HtmlImportMode): string[] =>
  htmlToCarve(html, { mode }).report.diagnostics.map((d) => d.code)

const rendered = (carve: string): string => renderHtml(parse(carve)).replace(/\n\s*/g, '')

describe('a cell alignment imports as the native marker', () => {
  it('maps text-align onto the marker run in semantic and roundtrip', () => {
    const html = '<table><tr><td style="text-align:right">a</td><td>b</td></tr></table>'
    for (const mode of ['semantic', 'roundtrip'] as const) {
      expect(imported(html, mode)).toBe('|> a | b |\n')
      expect(codes(html, mode)).toEqual([])
    }
  })

  it('maps vertical-align through the inherited-horizontal marker', () => {
    for (const [value, run] of [['top', '?^'], ['middle', '?~'], ['bottom', '?v']] as const) {
      const html = `<table><tr><td style="vertical-align:${value}">a</td><td>b</td></tr></table>`
      expect(imported(html, 'semantic')).toBe(`|${run} a | b |\n`)
      expect(codes(html, 'semantic')).toEqual([])
    }
  })

  it('writes both axes as one run', () => {
    const html = '<table><tr><td style="text-align:left;vertical-align:top">a</td></tr></table>'
    expect(imported(html, 'semantic')).toBe('|<^ a |\n')
  })

  /**
   * THE LOAD-BEARING ASSERTION. A test on the emitted Carve alone would pass
   * for a spelling no renderer reads, and the whole point of the marker over
   * the key-value is which bytes come back out.
   */
  it('gives back the declaration it was handed', () => {
    for (const [declaration, css] of [
      ['text-align:right', 'text-align: right;'],
      ['vertical-align:top', 'vertical-align: top;'],
      ['text-align:left;vertical-align:bottom', 'text-align: left; vertical-align: bottom;'],
    ] as const) {
      const html = `<table><tr><td style="${declaration}">a</td></tr></table>`
      expect(rendered(imported(html, 'semantic'))).toContain(`<td style="${css}">a</td>`)
    }
  })

  /**
   * `carve -> html -> carve -> html` has to land on itself. It did not with the
   * key-value spelling, which is the reason this ticket is not a preference.
   */
  it('is a fixed point through HTML', () => {
    for (const src of ['|> a | b |\n', '|?^ a | b |\n', '|<^ a |\n', '|=> h |\n| a |\n', '| a | b |\n| c |> d |\n']) {
      const first = renderHtml(parse(src))
      const back = htmlToCarve(first, { mode: 'roundtrip' }).value
      expect(back).toBe(src)
      expect(renderHtml(parse(back))).toBe(first)
    }
  })

  /**
   * The boundary a careless fix crosses.
   */
  it('still drops and reports in safe', () => {
    for (const declaration of ['text-align:right', 'vertical-align:top']) {
      const html = `<table><tr><td style="${declaration}">a</td><td>b</td></tr></table>`
      expect(imported(html, 'safe')).toBe('| a | b |\n')
      expect(codes(html, 'safe')).toEqual(['style-unmapped'])
    }
  })

  /**
   * The control. Without it the change reads as a blanket "stop reporting".
   */
  it('still reports a property the language cannot spell', () => {
    for (const declaration of ['color:red', 'width:50%', 'font-weight:bold', 'border:1px solid']) {
      const html = `<table><tr><td style="${declaration}">a</td></tr></table>`
      expect(imported(html, 'semantic')).toBe('| a |\n')
      expect(codes(html, 'semantic')).toEqual(['style-unmapped'])
    }
  })

  /**
   * A value outside Carve's enum is not quietly rounded to one that is.
   */
  it('still reports a value outside the enum', () => {
    for (const declaration of ['text-align:justify', 'text-align:start', 'vertical-align:baseline', 'vertical-align:4px']) {
      const html = `<table><tr><td style="${declaration}">a</td></tr></table>`
      expect(imported(html, 'semantic')).toBe('| a |\n')
      expect(codes(html, 'semantic')).toEqual(['style-unmapped'])
    }
  })

  /**
   * OFF A CELL there is no marker run. `align` is a legacy presentational
   * attribute HTML defines for these elements, so the key-value is faithful;
   * `valign` is defined for table cells and nothing else, so writing it onto a
   * paragraph would emit an attribute no reader honours - a spelling that looks
   * like a mapping and is not one.
   */
  it('keeps the key-value off a cell, for the horizontal axis only', () => {
    expect(imported('<p style="text-align:center">x</p>', 'semantic')).toBe('{align=center}\nx\n')
    expect(codes('<p style="text-align:center">x</p>', 'semantic')).toEqual([])
    expect(imported('<p style="vertical-align:top">x</p>', 'semantic')).toBe('x\n')
    expect(codes('<p style="vertical-align:top">x</p>', 'semantic')).toEqual(['style-unmapped'])
  })

  /**
   * A body cell repeating its column's value spells what the head already
   * says, and a round trip that wrote it would grow a marker on every body row
   * on each pass through HTML.
   */
  it('leaves a body cell bare where the head already says it', () => {
    const shared = '<table><thead><tr><th style="text-align:right">h</th></tr></thead><tbody><tr><td style="text-align:right">a</td></tr></tbody></table>'
    expect(imported(shared, 'semantic')).toBe('|=> h |\n| a |\n')

    // A cell that DISAGREES with its column keeps its own run: that is the only
    // thing overriding the default.
    const differing = '<table><thead><tr><th style="text-align:right">h</th></tr></thead><tbody><tr><td style="text-align:left">a</td></tr></tbody></table>'
    expect(imported(differing, 'semantic')).toBe('|=> h |\n|< a |\n')

    // And a column with no default at all leaves every cell stating its own.
    const headless = '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td style="text-align:right">a</td></tr></tbody></table>'
    expect(imported(headless, 'semantic')).toBe('|= h |\n|> a |\n')
  })

  /**
   * CSS beats the presentational attribute in HTML, and it has to beat it in
   * BOTH source orders - a browser does not read
   * `<td style="text-align:left" align="right">` as right-aligned just because
   * `align` was written second.
   */
  it('drops a presentational attribute a mapped declaration supersedes', () => {
    for (const html of [
      '<table><tr><td style="text-align:left" align="right">a</td></tr></table>',
      '<table><tr><td align="right" style="text-align:left">a</td></tr></table>',
      '<table><tr><td style="vertical-align:top" valign="bottom">a</td></tr></table>',
    ]) {
      expect(codes(html, 'semantic')).toEqual(['attribute-dropped'])
    }
    expect(imported('<table><tr><td align="right" style="text-align:left">a</td></tr></table>', 'semantic')).toBe('|< a |\n')
  })

  /**
   * A presentational attribute with no CSS beside it was always kept, and the
   * mapping must not start reporting it.
   */
  it('leaves a bare presentational attribute alone', () => {
    const html = '<table><tr><td align="right">a</td></tr></table>'
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      expect(imported(html, mode)).toBe('|{align=right} a |\n')
      expect(codes(html, mode)).toEqual([])
    }
  })
})
