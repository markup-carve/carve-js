import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L3: a refused `+` at an item's marker column ends the item's
// paragraph, as it already did for a quote, so the next line is not lazy item
// text and an indented opener after it interrupts the outer paragraph.
describe('a refused item plus ends the item paragraph', () => {
  const list = '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n'
  it.each([
    ['- a\n  - b\n  +\ntail\n  > q\n', `${list}<p>tail</p>\n<blockquote><p>q</p></blockquote>`],
    ['- a\n  - b\n  +\n%% c\ntail\n  > q\n', `${list}<p>tail</p>\n<blockquote><p>q</p></blockquote>`],
    ['- a\n  - b\n  +\ntail\n  ```\n  x\n  ```\n', `${list}<p>tail</p>\n<pre><code>x\n</code></pre>`],
    ['- a\n  - b\n  +\ntail\n  # h\n', `${list}<p>tail</p>\n<section id="h">\n  <h1>h</h1>\n</section>`],
  ])('%j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
