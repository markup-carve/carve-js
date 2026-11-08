import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('comment-shaped code payload does not extend an item', () => {
  it('ends an open fence when a lower comment span leaves the item', () => {
    expect(carveToHtml('- ```\n  %%%\n%%%\ny\n')).toBe('<ul>\n  <li>\n    <pre><code>%%%\n</code></pre>\n  </li>\n</ul>')
  })
})
