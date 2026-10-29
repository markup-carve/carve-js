import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an outer item tight when the blank after its nested list is fence payload', () => {
  expect(carveToHtml('- outer\n  - head\n\n    ```\n    ```\n    a\n   ```\n\n  tail\n')).toBe(
    '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code></code></pre>\n        a\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>',
  )
})
