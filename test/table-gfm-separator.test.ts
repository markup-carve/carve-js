import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

/**
 * GFM-style header separator rows, in addition to Carve's native `|=` header
 * cells. A delimiter row (every cell a run of dashes with optional alignment
 * colons) directly after the first row turns it into a <thead> header and sets
 * per-column alignment. Matches carve-php.
 */
describe('GFM table header separator', () => {
  it('makes the first row a header', () => {
    expect(h('| x | y |\n|---|---|')).toBe(
      '<table>\n  <thead><tr><th>x</th><th>y</th></tr></thead>\n</table>',
    )
  })

  it('accepts spaces in the delimiter row', () => {
    expect(h('| x | y |\n| --- | --- |')).toBe(
      '<table>\n  <thead><tr><th>x</th><th>y</th></tr></thead>\n</table>',
    )
  })

  it('sets per-column alignment from colons, on header and body', () => {
    expect(h('| x | y |\n|:--|--:|\n| a | b |')).toBe(
      '<table>\n' +
        '  <thead><tr><th style="text-align: left;">x</th>' +
        '<th style="text-align: right;">y</th></tr></thead>\n' +
        '  <tbody>\n' +
        '    <tr><td style="text-align: left;">a</td>' +
        '<td style="text-align: right;">b</td></tr>\n' +
        '  </tbody>\n' +
        '</table>',
    )
  })

  it('centers with colons on both sides', () => {
    expect(h('| x |\n|:-:|\n| a |')).toBe(
      '<table>\n' +
        '  <thead><tr><th style="text-align: center;">x</th></tr></thead>\n' +
        '  <tbody>\n    <tr><td style="text-align: center;">a</td></tr>\n  </tbody>\n' +
        '</table>',
    )
  })

  it('does not treat a non-second-row delimiter as a separator', () => {
    // No delimiter at row 1 -> all rows are data (a `---` cell is content).
    expect(h('| a | b |\n| c | d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n' +
        '    <tr><td>c</td><td>d</td></tr>\n  </tbody>\n</table>',
    )
  })
})
