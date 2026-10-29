import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a footnote on a quoted list marker line', () => {
  it('leaves the marker with a note in an outer quoted list', () => {
    const source = '> - > [^a]: a\n>   > +\n>   > > r\n\nr[^a]\n'
    expect(carveToHtml(source)).toContain('<li id="fn1">\n      <p>a</p>\n      <blockquote><p>r</p></blockquote>')
  })

  it('takes a following list through the continuation marker', () => {
    const source = '- > [^a]: a\n  > +\n  > - s\n\nr[^a]\n'
    expect(carveToHtml(source)).toContain('<li id="fn1">\n      <p>a</p>\n      <ul>\n        <li>s</li>')
  })

  // The `+` is the note's lazy text (carve#3885); the nested quote opens in the quote.
  it('takes the following quote continuation marker as note text', () => {
    const source = '- > [^a]: a\n  > +\n  > > r\n\nr[^a]\n'
    expect(carveToHtml(source)).toBe(
      '<ul>\n  <li>\n    <blockquote>\n      <blockquote><p>r</p></blockquote>\n    </blockquote>\n  </li>\n</ul>\n' +
      '<p>r<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
      '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
      '      <p>a\n+<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
      '    </li>\n  </ol>\n</section>',
    )
  })
})
