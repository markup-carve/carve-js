import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens a sibling after a refused multiline comment in a nested item', () => {
  expect(carveToHtml('- a\n  - b\n  {% c\nd %}\n  - z\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}</li>\n      <li>z</li>\n    </ul>\n  </li>\n</ul>',
  )
})
