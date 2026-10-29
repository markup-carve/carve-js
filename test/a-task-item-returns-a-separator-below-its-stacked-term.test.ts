import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('returns a separator at the parent content column from a stacked task item', () => {
  expect(carveToHtml('* [ ] - a\n    :: m\n  : l\n  : l\n')).toBe(
    '<ul class="task-list">\n' +
    '  <li><input type="checkbox" disabled> \n' +
    '    <ul>\n' +
    '      <li>a</li>\n' +
    '    </ul>\n' +
    '    <dl>\n' +
    '      <dt>m</dt>\n' +
    '      <dd>l</dd>\n' +
    '      <dd>l</dd>\n' +
    '    </dl>\n' +
    '  </li>\n' +
    '</ul>',
  )
})
