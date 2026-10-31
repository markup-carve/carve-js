import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a block after a plus-attached paragraph decides later ownership', () => {
  it('releases a flush-left line after an item-owned heading', () => {
    const expected = '<ul>\n  <li>a\n    q\n    <h1 id="h">h</h1>\n  </li>\n</ul>\n<p>next</p>'
    expect(carveToHtml('- a\n+\nq\n  # h\nnext\n')).toBe(expected)
  })

  it('folds a marker below the item column into an open child paragraph', () => {
    const expected = '<ol>\n  <li>a\n    q\n    <ul>\n      <li>c\n- end</li>\n    </ul>\n  </li>\n</ol>'
    expect(carveToHtml('1. a\n+\nq\n   - c\n  - end\n')).toBe(expected)
  })

  it('keeps the published sibling and heading followers in the item', () => {
    expect(carveToHtml('- a\n+\nq\n - c\n')).toBe('<ul>\n  <li>a\n    q\n  </li>\n  <li>c</li>\n</ul>')
    expect(carveToHtml('- a\n+\nq\n  # h\n')).toBe('<ul>\n  <li>a\n    q\n    <h1 id="h">h</h1>\n  </li>\n</ul>')
  })
})
