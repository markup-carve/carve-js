import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens and closes a tabbed fence in the innermost item frame (carve-js#4830)', () => {
  const source = '- a\n  - a\n \t- a\n  \t  ```\n  \t  c\n  \t  ```\n'
  expect(carveToHtml(source)).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>a\n        <ul>\n          <li>a\n            <pre><code>c\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
  expect(carveToHtml(source.replace('  \t  c\n', '  \t  \tdeep\n'))).toContain(
    '<pre><code>\tdeep\n</code></pre>',
  )
})
