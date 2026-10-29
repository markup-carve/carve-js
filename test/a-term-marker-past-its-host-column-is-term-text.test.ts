import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens a second term on a marker past the list content column', () => {
  expect(carveToHtml('* k\n\n   :: m\n  l\n    :: m\n')).toBe(
    '<ul>\n  <li>k\n    <dl>\n      <dt>m\nl</dt>\n      <dt>m</dt>\n    </dl>\n  </li>\n</ul>',
  )
})

it('lets an opener below the term block base return to the item', () => {
  expect(carveToHtml('* k\n\n    :: m\n   # H\n')).toBe(
    '<ul>\n  <li>k\n    <dl>\n      <dt>m</dt>\n    </dl>\n    <h1 id="H">H</h1>\n  </li>\n</ul>',
  )
})

