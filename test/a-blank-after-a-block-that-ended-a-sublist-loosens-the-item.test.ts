import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

// carve#4054: a block below a sublist's content column ends that sublist, so a
// later paragraph at or past the column is the outer item's and a blank before it loosens.
describe('a blank after a block that ended a sublist', () => {
  it.each([
    ["- foo\n  - +\n   # H\n\n\n     x\n", "<ul>\n  <li><p>foo</p>\n    <ul>\n      <li>+</li>\n    </ul>\n    <h1 id=\"H\">H</h1>\n    <p>x</p>\n  </li>\n</ul>"],
    ["- foo\n  - s\n  # H\n\n    x\n", "<ul>\n  <li><p>foo</p>\n    <ul>\n      <li>s</li>\n    </ul>\n    <h1 id=\"H\">H</h1>\n    <p>x</p>\n  </li>\n</ul>"],
    ["- foo\n  - s\n  ---\n\n     x\n", "<ul>\n  <li><p>foo</p>\n    <ul>\n      <li>s</li>\n    </ul>\n    <hr>\n    <p>x</p>\n  </li>\n</ul>"],
    ["- foo\n  - s\n  | a |\n\n    x\n", "<ul>\n  <li><p>foo</p>\n    <ul>\n      <li>s</li>\n    </ul>\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n    <p>x</p>\n  </li>\n</ul>"],
    ["- foo\n  - s\n   > q\n\n    x\n", "<ul>\n  <li><p>foo</p>\n    <ul>\n      <li>s</li>\n    </ul>\n    <blockquote><p>q</p></blockquote>\n    <p>x</p>\n  </li>\n</ul>"],
    ["> - foo\n>   - s\n>   # H\n>\n>     x\n", "<blockquote>\n  <ul>\n    <li><p>foo</p>\n      <ul>\n        <li>s</li>\n      </ul>\n      <h1 id=\"H\">H</h1>\n      <p>x</p>\n    </li>\n  </ul>\n</blockquote>"],
  ])('%j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
