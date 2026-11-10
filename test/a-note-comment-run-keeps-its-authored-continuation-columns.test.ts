import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `{%` run on a note head continues on lines past the note's body column,
// in quote-local columns (CARVE-P2-035, PART 9 §24 C5). Any line is comment
// text of the run, so a quote- or fence-shaped one reads like a plain word,
// even where the ownership walk moved it (markup-carve/carve-js#4901).
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

const NOTE_REF = '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'
const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

// Each host with continuation leads past its note's body column, in quote-local columns.
const HOSTS: Array<[(lead: string, middle: string) => string[], string[]]> = [
  [(l, m) => ['[^n]: {% a', l + m, l + 'z %}', 'plain', '', 'x[^n]'], ['\t', '   ', '      ', '       ']],
  [(l, m) => ['- [^n]: {% a', l + m, l + 'z %}', 'plain', '', 'x[^n]'], ['\t ', '      ', '        ', '         ']],
  [(l, m) => ['> [^n]: {% a', '> ' + l + m, '> ' + l + 'z %}', 'plain', '', 'x[^n]'], ['\t', '   ', '      ']],
]

describe('a note comment run keeps its authored continuation columns', () => {
  for (const [host, leads] of HOSTS) {
    for (const lead of leads) {
      for (const middle of ['> x', '> > x', '%%%', '```']) {
        const source = host(lead, middle).join('\n') + '\n'
        const twin = host(lead, 'b').join('\n') + '\n'
        it(JSON.stringify(source), () => expect(html(source)).toBe(html(twin)))
      }
    }
  }

  it('reads a quote-shaped line as run text', () => {
    expect(html('[^n]: {% a\n       > x\n       z %}\n\nx[^n]\n')).toBe(
      `${NOTE_REF}<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1"><p>${backlink}</p></li></ol></section>`)
  })

  it('still refuses an attribute run whose middle line is no attribute', () => {
    expect(html('[^n]: {.x\n      > x\n      .y}\n\nx[^n]\n')).toBe(
      `${NOTE_REF}<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1"><p>{.x</p>` +
      `<blockquote><p>x\n.y}</p></blockquote><p>${backlink}</p></li></ol></section>`)
  })
})
