import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends the item at an unmatched comment fence', () => {
  expect(carveToHtml('- x\n%%%\n%%`%\ny\n')).toBe(
    '<ul>\n  <li>x</li>\n</ul>\n<p>y</p>',
  )
})
