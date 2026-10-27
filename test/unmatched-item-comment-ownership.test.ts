import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('retains the item after an unmatched comment fence', () => {
  expect(carveToHtml('- x\n%%%\n%%`%\ny\n')).toBe(
    '<ul>\n  <li>x\n    y\n  </li>\n</ul>',
  )
})
