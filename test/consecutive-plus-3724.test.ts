import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases = [
  ['quote', '> q\n+\n+\n', '<blockquote>\n  <p>q</p>\n  <p>+</p>\n</blockquote>'],
  ['loose list', '- q\n+\n+\n\n- r\n', '<ul>\n  <li><p>q</p>\n    <p>+</p>\n  </li>\n  <li><p>r</p></li>\n</ul>'],
  ['description', ':: term\n:  q\n+\n+\n', '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>q</p>\n    <p>+</p>\n  </dd>\n</dl>'],
  ['footnote', 'x[^a]\n\n[^a]: q\n+\n+\n', '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>q</p>\n      <p>+<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'],
] as const

for (const [host, source, expected] of cases) {
  it(`attaches the second plus as its own paragraph in a ${host}`, () => {
    expect(carveToHtml(source)).toBe(expected)
    expect(parse(source)).toBeDefined()
  })
}
