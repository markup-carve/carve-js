import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5755 option 1: a leading tab is measured in each frame's coordinates, for ownership and code payload alike.
const cases: Array<[string, string, string]> = [
  ['a tab-led line reaches the nested item from the outer body', '- a\n\t- a\n\n  \tb\n',
    '<ul>\n  <li>a\n    <ul>\n      <li><p>a</p>\n        <p>b</p>\n      </li>\n    </ul>\n  </li>\n</ul>'],
  ['a tab-led line short of a tab-led marker per frame stays in the outer item', '- a\n\t\t- a\n\t\t> z\n',
    '<ul>\n  <li>a\n    <ul>\n      <li>a</li>\n    </ul>\n    <blockquote><p>z</p></blockquote>\n  </li>\n</ul>'],
  ['a tab-led marker after a blank loosens the item it nests in', '- a\n  - a\n\n\t- c\n',
    '<ul>\n  <li>a\n    <ul>\n      <li><p>a</p>\n        <ul>\n          <li>c</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>'],
  ['a tab-led fence at a nested item column opens there', '- a\n  - a\n  \t```\n  \tk\n  \t```\n',
    '<ul>\n  <li>a\n    <ul>\n      <li>a\n        <pre><code>k\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>'],
  ['a tab-led quote in a note-nested item opens there', '[^n]: a\n  - a\n  \t> z\n\nx[^n]\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>a</p>\n      <ul>\n        <li>a\n          <blockquote><p>z</p></blockquote>\n        </li>\n      </ul>\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'],
  ['a tab in a code payload keeps the columns of its space spelling', '- a\n  ```\n  \tk\n  ```\n',
    '<ul>\n  <li>a\n    <pre><code>  k\n</code></pre>\n  </li>\n</ul>'],
]

it.each(cases)('%s', (_name, source, html) => {
  expect(carveToHtml(source).trim()).toBe(html)
})
