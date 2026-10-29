import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

// Only a separator at the sub-item's marker column returns to the outer item;
// one past it stays in the sub-item's term or list (carve-js#3943).
describe('a separator below a marker-line sub-item term', () => {
  it('keeps the next opener at the sub-item content column in the sub-item', () => {
    expect(h('- * :: t\n   : d\n    > r\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <dl>\n          <dt>t\n: d</dt>\n        </dl>\n        <blockquote><p>r</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(h('- * :: t\n    : d\n    > r\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <dl>\n          <dt>t</dt>\n          <dd>d</dd>\n        </dl>\n        <blockquote><p>r</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(h('- 1. :: t\n   : d\n     # h\n')).toBe(
      '<ul>\n  <li>\n    <ol>\n      <li>\n        <dl>\n          <dt>t\n: d</dt>\n        </dl>\n        <h1 id="h">h</h1>\n      </li>\n    </ol>\n  </li>\n</ul>',
    )
    expect(h('> - * :: t\n>    : d\n>     :: u\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <dl>\n            <dt>t\n: d</dt>\n            <dt>u</dt>\n          </dl>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('still returns a separator at the sub-item marker column to the outer item', () => {
    expect(h('- * :: t\n  : d\n    > r\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <dl>\n          <dt>t</dt>\n        </dl>\n      </li>\n    </ul>\n    : d\n    <blockquote><p>r</p></blockquote>\n  </li>\n</ul>',
    )
  })
})
