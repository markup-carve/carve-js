import { expect, it } from 'vitest'
import { carveToHtml, decisionTrace } from '../src/index.js'

it('closes the first fence and opens the second across mixed tab runs (carve-js#4833)', () => {
  const source = '- a\n  - a\n  \t   ```\n  \t   ```\n  \t\t```\n'
  expect(carveToHtml(source)).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>a\n        <pre><code></code></pre>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
  expect(decisionTrace(source).slice(3).map(record => record.form)).toEqual(['closer', 'code'])
})
