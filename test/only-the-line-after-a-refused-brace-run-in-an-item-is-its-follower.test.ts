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

  it('leaves a real fence after a run in a nested quote closable', () => {
    expect(carveToHtml('- a\n  > q\n  {.x\n  .y}\n  ```\n  x\n  ```\n  # h\n').trim())
      .toBe('<ul>\n  <li>a\n    <blockquote><p>q\n{.x\n.y}</p></blockquote>\n    <pre><code>x\n</code></pre>\n    <h1 id="h">h</h1>\n  </li>\n</ul>')
  })

  it('keeps every payload line of a real fence after a run in a nested quote', () => {
    expect(carveToHtml('- +\n  > q\n  {.x\n  .y}\n  ```\n  - li\n  - lj\n').trim())
      .toBe('<ul>\n  <li>\n    <blockquote><p>q\n{.x\n.y}</p></blockquote>\n    <pre><code>- li\n- lj\n</code></pre>\n  </li>\n</ul>')
  })

  it('reads a shifted run in the middle of a paragraph', () => {
    expect(carveToHtml('- a\n   {.x\n   .y}\n   ```\n   - li\ntail\n').trim())
      .toBe('<ul>\n  <li>a\n{.x\n.y}\n<code></code>\n    <ul>\n      <li>li\ntail</li>\n    </ul>\n  </li>\n</ul>')
  })
})
