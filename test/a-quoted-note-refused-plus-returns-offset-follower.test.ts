import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('returns an offset follower of a refused quoted note plus to the quote (carve#5627)', () => {
  expect(carveToHtml('> [^a]: +\n>  v0\n\nsee[^a]\n')).toBe(
    '<blockquote><p>v0</p></blockquote>\n' +
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
    '<section role="doc-endnotes" aria-label="Footnotes">\n' +
    '  <hr>\n  <ol>\n    <li id="fn1">\n' +
    '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
    '    </li>\n  </ol>\n</section>')
})
