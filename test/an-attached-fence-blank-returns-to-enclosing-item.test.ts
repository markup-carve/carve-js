import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('reads a block after a nested attached fence in the enclosing item', () => {
  const source = '- - +\n  ```\n\n  x\n    # x\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>x</p>\n    <h1 id="x">x</h1>\n  </li>\n</ul>')
})

it('keeps nested quote coordinates when the blank ends the fence', () => {
  const source = '> - > - +\n>   > ```\n>   >\n>   > x\n'
  expect(carveToHtml(source)).toBe('<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n        <p>x</p>\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>')
})

it('keeps the attached host available to a later continuation marker', () => {
  const source = '- - +\n  ```\n\n  +\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>')
})
