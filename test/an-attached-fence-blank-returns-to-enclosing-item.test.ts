import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('reads a block after a nested attached fence in the enclosing item', () => {
  const source = '- - +\n  ```\n\n  x\n    # x\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>x</p>\n    <h1 id="x">x</h1>\n  </li>\n</ul>')
})
