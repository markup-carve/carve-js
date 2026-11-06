import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P0-011: a block at or past a container's content column ends the paragraph a
// first-block `+` pulled left of it (carve#5331 ruling, carve#5349).
describe('a block at the content column ends a pulled paragraph', () => {
  it.each([
    [
      'a heading after a marker-line + pulled paragraph (carve#5349)',
      '- +\nh\n  # H\n',
      "<ul>\n  <li>h\n    <h1 id=\"H\">H</h1>\n  </li>\n</ul>",
    ],
    [
      'a quote at the content column',
      '- +\nh\n  > q\n',
      "<ul>\n  <li>h\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>",
    ],
    [
      'a table row at the content column',
      '- +\nh\n  | a |\n',
      "<ul>\n  <li>h\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n  </li>\n</ul>",
    ],
    [
      'an ordered item',
      '1. +\nh\n   # H\n',
      "<ol>\n  <li>h\n    <h1 id=\"H\">H</h1>\n  </li>\n</ol>",
    ],
    [
      'a nested item',
      '- a\n  - +\n  h\n    # H\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>h\n        <h1 id=\"H\">H</h1>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a column-0 line after the block leaves the item',
      '- +\nh\n  # H\nz\n',
      "<ul>\n  <li>h\n    <h1 id=\"H\">H</h1>\n  </li>\n</ul>\n<p>z</p>",
    ],
    [
      'a text line at the content column still folds',
      '- +\nh\n  k\n',
      "<ul>\n  <li>h\nk</li>\n</ul>",
    ],
    [
      'the pulled paragraph of a description (carve#5331)',
      ':: t\n: +\nh\n  # H\n',
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>h</p>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>",
    ],
    [
      'an attribute run before the pulled paragraph of a description',
      ':: t\n: +\n{x}\nh\n  # H\n',
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <p x=\"\">h</p>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>",
    ],
    [
      'an attribute run before the pulled paragraph of an item',
      '- +\n{x}\nh\n  # H\n',
      "<ul>\n  <li><p x=\"\">h</p>\n    <h1 id=\"H\">H</h1>\n  </li>\n</ul>",
    ],
    [
      'an attribute run in a nested description',
      '- item\n  :: t\n  : +\n  {x}\n  h\n    # H\n',
      "<ul>\n  <li>item\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <p x=\"\">h</p>\n        <h1 id=\"H\">H</h1>\n      </dd>\n    </dl>\n  </li>\n</ul>",
    ],
    [
      'a description in a loose item, then a column-0 line',
      '- item\n\n  :: t\n  : +\n  h\n    # H\nz\n',
      "<ul>\n  <li><p>item</p>\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <p>h</p>\n        <h1 id=\"H\">H</h1>\n      </dd>\n    </dl>\n  </li>\n</ul>\n<p>z</p>",
    ],
    [
      'a fence an own-line + item opens itself ends below its column',
      '- a\n+\nh\n  ```\nz\n',
      "<ul>\n  <li>a\n    h\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>z</p>",
    ],
    [
      'a fence an own-line + item opens itself keeps the blank',
      '- a\n+\nh\n  ```\n\nz\n',
      "<ul>\n  <li>a\n    h\n    <pre><code>\n</code></pre>\n  </li>\n</ul>\n<p>z</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
