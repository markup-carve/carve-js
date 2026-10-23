import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a footnote on a quoted list marker line', () => {
  it('leaves the following quote continuation marker in the quote', () => {
    const source = '- > [^a]: a\n  > +\n  > > r\n\nr[^a]\n'
    expect(carveToHtml(source)).toBe(
      '<ul>\n  <li>\n    <blockquote>\n      <p>+</p>\n      <blockquote><p>r</p></blockquote>\n    </blockquote>\n  </li>\n</ul>\n' +
      '<p>r<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
      '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
      '      <p>a<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
      '    </li>\n  </ol>\n</section>',
    )
  })
})
