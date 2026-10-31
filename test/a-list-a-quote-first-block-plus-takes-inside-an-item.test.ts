import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

// carve-js#4044: an item frames the follower of a quote's first-block `+` as
// lazy text; the `+` takes it as a block, at its own indentation.
describe("a list a quote's first-block + takes inside an item", () => {
  it.each([
    ["- w\n  > +\n  - a\n", "<ul>\n  <li>w\n    <blockquote>\n      <ul>\n        <li>a</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
    ["- w\n  > +\n  - a\n", "<ul>\n  <li>w\n    <blockquote>\n      <ul>\n        <li>a</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
    ["- w\n  > +\n  - a\n\t- b\n", "<ul>\n  <li>w\n    <blockquote>\n      <ul>\n        <li>a\n          <ul>\n            <li>b</li>\n          </ul>\n        </li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
    ["- w\n\n  > +\n  - a\n    - b\n    +\n    +\n", "<ul>\n  <li>w\n    <blockquote>\n      <ul>\n        <li>a\n          <ul>\n            <li>b\n              +\n            </li>\n          </ul>\n        </li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
    ["1. w\n   > +\n   - a\n     - b\n", "<ol>\n  <li>w\n    <blockquote>\n      <ul>\n        <li>a\n          <ul>\n            <li>b</li>\n          </ul>\n        </li>\n      </ul>\n    </blockquote>\n  </li>\n</ol>"],
    ["- w\n  > +\n  - a\n  - b\n", "<ul>\n  <li>w\n    <blockquote>\n      <ul>\n        <li>a</li>\n        <li>b</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
  ])('%j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
