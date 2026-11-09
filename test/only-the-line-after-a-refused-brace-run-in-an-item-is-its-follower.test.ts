/*
 * carve#5610: in a list item, only the line right after a refused brace run is
 * forced into its paragraph, a fence-shaped one included; a fence follower with
 * a closer ahead keeps its lines through that closer (CARVE-P2-035).
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const sublist = '<ul>\n  <li>{.x\n.y}\n<code></code>\n    <ul>\n      <li>li\ntail</li>\n    </ul>\n  </li>\n</ul>'

describe('the follower of a refused brace run in an item', () => {
  it('lets a marker after an unclosed fence follower open a sublist', () => {
    expect(carveToHtml('- +\n  {.x\n  .y}\n  ```\n  - li\ntail\n').trim()).toBe(sublist)
  })

  it('reads the run one column past the content column the same way', () => {
    expect(carveToHtml('- +\n   {.x\n   .y}\n   ```\n   - li\ntail\n').trim()).toBe(sublist)
  })

  it('keeps every line through a fence follower closer', () => {
    expect(carveToHtml('- +\n  {.x\n  .y}\n  ```\n  - li\n  - lj\n  ```\ntail\n').trim())
      .toBe('<ul>\n  <li>{.x\n.y}\n<code>\n- li\n- lj\n</code>\ntail</li>\n</ul>')
  })
})
