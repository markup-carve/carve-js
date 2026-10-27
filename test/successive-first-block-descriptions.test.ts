import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps successive first-block descriptions empty before a list', () => {
  expect(carveToHtml(':: t\n: +\n: +\n- a list\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd></dd>\n  <dd></dd>\n</dl>\n<ul>\n  <li>a list</li>\n</ul>',
  )
})
