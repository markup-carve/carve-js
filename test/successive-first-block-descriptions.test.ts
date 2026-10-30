import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('attaches a list to the last of successive first-block descriptions', () => {
  expect(carveToHtml(':: t\n: +\n: +\n- a list\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>+</dd>\n  <dd>\n    <ul>\n      <li>a list</li>\n    </ul>\n  </dd>\n</dl>',
  )
})
