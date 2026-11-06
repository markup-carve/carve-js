import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A block a list quote's `+` attached is measured from the quote marker, its innermost opener,
// and a line the stanza takes lazily stays in it (PART 0 S4, CARVE-P0-020).
describe('a list quote + block keeps its lazy lines and its column', () => {
  it.each([
    [
      'a plain line after the line block a list quote + attached folds into the stanza (carve-js#4614)',
      '- > +\n  ::: |\n    k\nz\n',
      "<ul>\n  <li>\n    <blockquote>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;k<br>\nz</p>\n      </div>\n    </blockquote>\n  </li>\n</ul>",
    ],
    [
      'the same after a task item quote',
      '- [ ] > +\n  ::: |\n    k\nz\n',
      "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled> \n    <blockquote>\n\n    </blockquote>\n    <div class=\"line-block\">\n      <p>&nbsp;&nbsp;k<br>\nz</p>\n    </div>\n  </li>\n</ul>",
    ],
    [
      'the same after an ordered item quote',
      '1. > +\n   ::: |\n     k\nz\n',
      "<ol>\n  <li>\n    <blockquote>\n      <div class=\"line-block\">\n        <p>&nbsp;&nbsp;k<br>\nz</p>\n      </div>\n    </blockquote>\n  </li>\n</ol>",
    ],
    [
      'the same after a stacked item quote',
      '- - > +\n    ::: |\n      k\nz\n',
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <blockquote>\n          <div class=\"line-block\">\n            <p>&nbsp;&nbsp;k<br>\nz</p>\n          </div>\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a column-0 fence after a stacked quote + block opens at document level (carve-js#4613)',
      '- - > +\n    ```\n    k\n```\n',
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <blockquote>\n          <pre><code>k\n</code></pre>\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code></code></pre>",
    ],
    [
      'a column-0 colon line after it',
      '- - > +\n    ::: note\n    k\n:::\n',
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <blockquote>\n          <aside class=\"admonition note\" aria-label=\"Note\">\n            <p>k</p>\n          </aside>\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>\n<div>\n\n</div>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
