import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L1 and L3 (carve#4398): a blank before a `+` owned by a list deeper
// than the item's own sublist stays inside that sublist and leaves the parent tight.
describe('a blank before a plus in a stacked sublist keeps the parent tight', () => {
  it.each([
    [
      'the ticket shape',
      '- a\n  - - x\n\n    +\n    y\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>\n        <ul>\n          <li>x\n            y\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'an ordered inner item',
      '- a\n  - 1. x\n\n    +\n    y\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>\n        <ol>\n          <li>x\n            y\n          </li>\n        </ol>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a quote attached after the blank',
      '- a\n  - - x\n\n    +\n    > y\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>\n        <ul>\n          <li>x\n            <blockquote><p>y</p></blockquote>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a three-deep stack',
      '- a\n  - - - x\n\n      +\n      y\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <ul>\n              <li>x\n                y\n              </li>\n            </ul>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a quoted outer list',
      '> - a\n>   - - x\n>\n>     +\n>     y\n',
      "<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>\n          <ul>\n            <li>x\n              y\n            </li>\n          </ul>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>",
    ],
    [
      'the direct sublist plus still loosens',
      '- a\n  - - x\n\n  +\n  y\n',
      "<ul>\n  <li><p>a</p>\n    <ul>\n      <li>\n        <ul>\n          <li>x</li>\n        </ul>\n        y\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'an unstacked sublist plus still loosens',
      '- a\n  - x\n\n  +\n  y\n',
      "<ul>\n  <li><p>a</p>\n    <ul>\n      <li>x\n        y\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
