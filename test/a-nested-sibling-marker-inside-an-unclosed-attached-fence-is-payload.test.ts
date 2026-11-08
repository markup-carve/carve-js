import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5499 option 2: a sibling marker inside an unclosed fence a marker-line `+`
// attached is fence content whether or not a blank follows. 0.1.14 scopes it to a
// host list inside an item; the top-level host keeps its reading (carve#5531).
const stacked = (inner: string) =>
  `<ul>\n  <li>\n    <ul>\n      <li>\n${inner}\n      </li>\n    </ul>\n  </li>\n</ul>`

describe('a sibling marker inside a nested item\'s unclosed attached fence', () => {
  it('is code when a later block of the inner item follows a blank', () => {
    expect(carveToHtml('- - +\n  ```\n  - z\n\n    q\n').trim()).toBe(
      stacked('        <pre><code>- z\n</code></pre>\n        <p>q</p>'))
  })

  it('is code for every marker kind', () => {
    for (const marker of ['* z', '1. z', 'a) z', '- [ ] z']) {
      expect(carveToHtml(`- - +\n  ~~~\n  ${marker}\n\n    q\n`)).toContain(`<pre><code>${marker}\n</code></pre>\n        <p>q</p>`)
    }
  })

  it('is code in an item nested below a paragraph', () => {
    expect(carveToHtml('- a\n  - +\n  ```\n  - z\n\n    q\n').trim()).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code>- z\n</code></pre>\n        <p>q</p>\n      </li>\n    </ul>\n  </li>\n</ul>')
  })

  it('leaves the top-level host reading unchanged', () => {
    expect(carveToHtml('- +\n```\n- z\n\nq\n').trim()).toBe(
      '<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n  <li>z</li>\n</ul>\n<p>q</p>')
  })
})
