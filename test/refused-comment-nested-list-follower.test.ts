import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('assigns a marker after a below-column refused comment to its surviving list frame', () => {
  expect(carveToHtml('- a\n  1. b\n    {% c\n    d %}\n    - z\n')).toBe(
    '<ul>\n  <li>a\n    <ol>\n      <li>b\n{% c\nd %}</li>\n    </ol>\n    <ul>\n      <li>z</li>\n    </ul>\n  </li>\n</ul>',
  )
  expect(carveToHtml('- a\n   - b\n    {% c\n    d %}\n    - z\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}</li>\n      <li>z</li>\n    </ul>\n  </li>\n</ul>',
  )
  expect(carveToHtml('- a\n  - b\n   {% c\n   d %}\n    - z\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}\n- z</li>\n    </ul>\n  </li>\n</ul>',
  )
})
