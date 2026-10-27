import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a second refused marker in a nested item', () => {
  expect(carveToHtml('- a\n  - b\n  +\n  +\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n        +\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
})

it('keeps a second refused marker in a root item', () => {
  expect(carveToHtml('- a\n+\n+\n- b\n')).toBe(
    '<ul>\n  <li>a\n    +\n  </li>\n  <li>b</li>\n</ul>',
  )
})
