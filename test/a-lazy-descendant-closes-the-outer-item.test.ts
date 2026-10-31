import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a block after a lazy line in a descendant item', () => {
  it('ends the outer item when the deepest paragraph closes', () => {
    expect(carveToHtml('- - a\n   c\n    # h\nz\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\nc\n        <h1 id="h">h</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>z</p>',
    )
  })

  it('does the same after a table row in a deeper item', () => {
    expect(carveToHtml('- - - a\n   c\n    | x |\nz\n')).toContain('</ul>\n<p>z</p>')
  })
})
