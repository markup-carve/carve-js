import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('loosens an outer item after a blank following its nested list', () => {
  expect(carveToHtml('- outer\n  - head\n\n    ```\n    ```\n    a\n   ```\n\n  tail\n')).toBe(
    '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <pre><code></code></pre>\n        a\n<code></code>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
  )
})
