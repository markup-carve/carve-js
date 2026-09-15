import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/html-import.js'
import { renderHtml } from '../src/render-html.js'
import { parse } from '../src/parse.js'
import { renderCarve } from '../src/render-carve.js'

/**
 * A span marker is always written as a plain cell (`| < |`), so a header row
 * whose spans form a TRAILING run keeps the native `|=` form - the span
 * absorbs into the header on its left and the `|=` markers still promote the
 * row. The writer used to fall back to a GFM delimiter row for ANY header
 * span, which turned an ordinary colspan header into `| A | B | < |` +
 * `|---|---|---|` instead of the cleaner `|= A |= B | < |`.
 *
 * The fallback is still needed where the native form cannot promote the row: a
 * LEADING span (no `|=` anchor before it) and a real cell AFTER a span (which
 * would have to be written `|=< K`, read as an aligned header rather than the
 * promoted data cell). Both are pinned here so the narrowing cannot creep.
 */
const carve = (html: string): string => htmlToCarve(html, { mode: 'roundtrip' }).value
const back = (carveSrc: string): string => renderHtml(parse(carveSrc)).replace(/\n\s*/g, '')

describe('a trailing header span writes the native form', () => {
  it('imports a colspan header as native |= cells, not a delimiter row', () => {
    const html =
      '<table><caption>Results</caption>' +
      '<thead><tr><th>Engine</th><th colspan="2">Timing</th></tr></thead>' +
      '<tbody><tr><td>carve-js</td><td>12ms</td><td>ok</td></tr></tbody></table>'
    expect(carve(html)).toBe('|= Engine |= Timing | < |\n| carve-js | 12ms | ok |\n^ Results\n')
  })

  it('is fmt-idempotent and renders the colspan', () => {
    const src = '|= Engine |= Timing | < |\n| carve-js | 12ms | ok |\n'
    expect(renderCarve(parse(src))).toBe(src)
    expect(back(src)).toContain('<th scope="col" colspan="2">Timing</th>')
  })

  it('keeps the delimiter row for a leading span, which has no anchor', () => {
    expect(carve('<table><tbody><tr><td colspan="2">a</td></tr><tr><td>b</td><td>c</td></tr></tbody></table>'))
      .not.toContain('|=')
    // A header row that opens on a span still needs the delimiter to promote it.
    const leading = '| < | b |\n|---|---|\n| c | d |\n'
    expect(renderCarve(parse(leading))).toBe(leading)
  })

  it('keeps the delimiter row when a real cell follows a header span', () => {
    // H spans three columns, then K - the span is mid-row, not trailing.
    const midSpan = '|~ H | < | < |< K |\n|---|---|---|---|\n| p | q |> s | t |\n'
    expect(renderCarve(parse(midSpan))).toBe(midSpan)
  })

  it('keeps the delimiter row for a trailing rowspan, which does not absorb left', () => {
    // A first-row `^` is not a header cell on its own, so the native form would
    // drop the row out of the header. Only a trailing colspan run may go native.
    const rowspan = '| A | ^ |\n|---|---|\n| x | y |\n'
    expect(renderCarve(parse(rowspan))).toBe(rowspan)
  })
})
