import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/html-import.js'
import { renderHtml } from '../src/render-html.js'
import { parse } from '../src/parse.js'

/**
 * A rowspan holds its columns THROUGH its last row, so the column an imported
 * body cell is read into is the column the renderer reads it back out of.
 *
 * The import drops a body cell's alignment marker where the head already says
 * it, which needs the cell's column. That walk aged every hold at the end of
 * the row that opened it, so a span retired one row early: in the LAST row it
 * reaches, its columns read as free, every cell after them shifted one column
 * left, and a cell whose alignment happened to match the WRONG column was
 * deleted as inherited. Nothing reported it - no cell was refused - and the
 * re-render then spelled the column the cell had been misread into. An
 * alignment the source carried came back as a different one.
 *
 * THE ASSERTION IS THE RE-RENDER, not the emitted Carve. A marker missing from
 * the source is only a defect because `html -> carve -> html` gives back an
 * alignment the input did not have, and only the render shows that.
 *
 * The unspanned cases are settled with three-engine parity
 * (markup-carve/carve#1741, markup-carve/carve#1745, markup-carve/carve#1746)
 * and are pinned here as controls: this fix must not move them.
 */
const carve = (html: string): string => htmlToCarve(html, { mode: 'semantic' }).value
const back = (html: string): string => renderHtml(parse(carve(html))).replace(/\n\s*/g, '')
const codes = (html: string): string[] =>
  htmlToCarve(html, { mode: 'semantic' }).report.diagnostics.map((d) => d.code)

const head = '<thead><tr><th style="text-align:right">A</th><th style="text-align:left">B</th><th style="text-align:center">C</th></tr></thead>'

describe('a rowspan holds its column through its last row', () => {
  /**
   * The shape the walk got wrong. `q` sits in column B (left) and states
   * `right`; the retired hold read it into column A (right), matched, and
   * deleted it.
   */
  it('keeps an alignment in the last row a rowspan reaches', () => {
    const html = `<table>${head}<tbody>`
      + '<tr><td rowspan="2">x</td><td>y</td><td>z</td></tr>'
      + '<tr><td style="text-align:right">q</td><td>r</td></tr>'
      + '</tbody></table>'
    expect(codes(html)).toEqual([])
    expect(back(html)).toContain('<td style="text-align: right;">q</td>')
    expect(carve(html)).toBe('|=> A |=< B |=~ C |\n| x | y | z |\n| ^ |> q | r |\n')
  })

  /**
   * A longer span retires one row early too, so only its LAST row was wrong -
   * which is why a two-row case alone would not have shown the shape of it.
   */
  it('holds every row of a longer span, and no row past it', () => {
    const html = `<table>${head}<tbody>`
      + '<tr><td rowspan="3">x</td><td>y</td><td>z</td></tr>'
      + '<tr><td style="text-align:right">q1</td><td>r1</td></tr>'
      + '<tr><td style="text-align:right">q2</td><td>r2</td></tr>'
      + '<tr><td style="text-align:right">q3</td><td>r3</td></tr>'
      + '</tbody></table>'
    const rendered = back(html)
    for (const cell of ['q1', 'q2']) expect(rendered).toContain(`<td style="text-align: right;">${cell}</td>`)
    // The row after the span is a full row again: `q3` really is in column A,
    // really does repeat it, and really should carry no marker of its own.
    expect(rendered).toContain('<td style="text-align: right;">q3</td>')
    expect(carve(html)).toBe(
      '|=> A |=< B |=~ C |\n| x | y | z |\n| ^ |> q1 | r1 |\n| ^ |> q2 | r2 |\n| q3 | r3 |\n',
    )
  })

  /**
   * The span does not have to start the row, and the alignment does not have
   * to be horizontal.
   */
  it('holds a column a span opens mid-row, on either axis', () => {
    const mid = '<table><thead><tr><th style="text-align:left">A</th><th style="text-align:right">B</th><th style="text-align:center">C</th></tr></thead>'
      + '<tbody><tr><td>a</td><td rowspan="2">b</td><td>c</td></tr>'
      + '<tr><td>d</td><td style="text-align:right">e</td></tr></tbody></table>'
    expect(back(mid)).toContain('<td style="text-align: right;">e</td>')

    const vertical = '<table><thead><tr><th style="vertical-align:top">A</th><th style="vertical-align:bottom">B</th><th style="vertical-align:middle">C</th></tr></thead>'
      + '<tbody><tr><td rowspan="2">x</td><td>y</td><td>z</td></tr>'
      + '<tr><td style="vertical-align:top">q</td><td>r</td></tr></tbody></table>'
    expect(back(vertical)).toContain('<td style="vertical-align: top;">q</td>')
  })

  /**
   * A cell spanning both ways holds EVERY column it covers, and a header row
   * that spans down holds its column into the header rows below it - where the
   * column defaults themselves are being seeded, so a slip there mis-seeds the
   * column rather than mis-reading one cell.
   */
  it('holds a two-way span, and a span inside the head', () => {
    const both = '<table><thead><tr><th style="text-align:left">A</th><th style="text-align:right">B</th><th style="text-align:center">C</th><th style="text-align:left">D</th></tr></thead>'
      + '<tbody><tr><td rowspan="2" colspan="2">a</td><td>c</td><td>d</td></tr>'
      + '<tr><td style="text-align:left">e</td><td>f</td></tr></tbody></table>'
    expect(back(both)).toContain('<td style="text-align: left;">e</td>')

    const inHead = '<table><thead><tr><th rowspan="2" style="text-align:right">A</th><th style="text-align:left">B</th><th style="text-align:center">C</th></tr>'
      + '<tr><th style="text-align:center">B2</th><th style="text-align:left">C2</th></tr></thead>'
      + '<tbody><tr><td style="text-align:center">p</td><td>q</td><td>r</td></tr></tbody></table>'
    expect(back(inHead)).toContain('<td style="text-align: center;">p</td>')
  })

  /**
   * THE MEASUREMENT FOR THE OTHER HALF of markup-carve/carve-js#1503: a colspan
   * header seeding every column it covers. It is not a defect here, because
   * `renderHtml` seeds the same run - the source below carries no body marker
   * at all and still renders three centred columns - so a body cell repeating
   * `center` under any of them is spelling what the document already says.
   * Recorded so the next sweep does not re-find it.
   */
  it('seeds a colspan header across its span, because the renderer reads it back', () => {
    expect(renderHtml(parse('|~ H | < | < |< K |\n|---|---|---|---|\n| p | q | s | t |\n')).replace(/\n\s*/g, ''))
      .toContain('<td style="text-align: center;">p</td><td style="text-align: center;">q</td><td style="text-align: center;">s</td>')

    const html = '<table><thead><tr><th colspan="3" style="text-align:center">H</th><th style="text-align:left">K</th></tr></thead>'
      + '<tbody><tr><td style="text-align:center">p</td><td style="text-align:center">q</td><td style="text-align:right">s</td><td style="text-align:left">t</td></tr></tbody></table>'
    expect(carve(html)).toBe('|~ H | < | < |< K |\n|---|---|---|---|\n| p | q |> s | t |\n')
    const rendered = back(html)
    for (const [cell, css] of [['p', 'center'], ['q', 'center'], ['s', 'right'], ['t', 'left']] as const) {
      expect(rendered).toContain(`<td style="text-align: ${css};">${cell}</td>`)
    }
  })

  /**
   * THE CONTROLS. Settled, three-engine identical, and untouched by the walk.
   */
  it('leaves the unspanned cases where they were', () => {
    const shared = '<table><thead><tr><th style="text-align:right">h</th></tr></thead><tbody><tr><td style="text-align:right">a</td></tr></tbody></table>'
    expect(carve(shared)).toBe('|=> h |\n| a |\n')

    const differing = '<table><thead><tr><th style="text-align:right">h</th></tr></thead><tbody><tr><td style="text-align:left">a</td></tr></tbody></table>'
    expect(carve(differing)).toBe('|=> h |\n|< a |\n')

    const headless = '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td style="text-align:right">a</td></tr></tbody></table>'
    expect(carve(headless)).toBe('|= h |\n|> a |\n')

    expect(carve('<table><tr><td style="text-align:right">a</td><td>b</td></tr></table>')).toBe('|> a | b |\n')
    expect(carve('<table><tr><td style="text-align:left;vertical-align:top">a</td></tr></table>')).toBe('|<^ a |\n')
  })

  /**
   * And the walk must not have bought the kept marker with an unstable round
   * trip: a second pass through HTML has to land on the first.
   */
  it('is a fixed point from the second pass', () => {
    for (const html of [
      `<table>${head}<tbody><tr><td rowspan="2">x</td><td>y</td><td>z</td></tr><tr><td style="text-align:right">q</td><td>r</td></tr></tbody></table>`,
      `<table>${head}<tbody><tr><td rowspan="3">x</td><td>y</td><td>z</td></tr><tr><td>y2</td><td>z2</td></tr><tr><td style="text-align:center">q</td><td>r</td></tr></tbody></table>`,
    ]) {
      const first = carve(html)
      const second = htmlToCarve(renderHtml(parse(first)), { mode: 'semantic' }).value
      const third = htmlToCarve(renderHtml(parse(second)), { mode: 'semantic' }).value
      expect(third).toBe(second)
    }
  })
})
