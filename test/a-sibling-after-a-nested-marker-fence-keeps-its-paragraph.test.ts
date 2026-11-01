import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a lazy follower into a sibling after a deeper marker-line fence', () => {
  const source = '- - - a\n      - ~~~\n    - y\nz\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>a\n            <ul>\n              <li>\n                <pre><code></code></pre>\n              </li>\n            </ul>\n          </li>\n          <li>y\nz</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>')
})
