import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A line that writes `>` is inside that quote, so a footnote definition on it is not a lazy line below the note's quote.
describe('a quoted footnote definition below a deeper quote registers', () => {
  const notes = (first: string, second: string): string =>
    '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
    `      ${first}\n    </li>\n    <li id="fn2">\n${second}\n` +
    '      <p><a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'
  const refs = '<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>\n'
  const n = '<p>n<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>'
  const twoQuotes = '      <blockquote>\n        <blockquote><p>para</p></blockquote>\n      </blockquote>'

  it.each([
    ['[^p] [^c]\n\n[^c]: > > para\n  > [^p]: n\n', refs + notes(n, twoQuotes)],
    ['[^p] [^c]\n\n[^c]: > > para\n    > [^p]: n\n', refs + notes(n, twoQuotes)],
    ['[^p] [^c]\n\n[^c]: > > para\n [^p]: n\n', refs + notes(n, twoQuotes)],
  ])('renders %j as the spec model', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
