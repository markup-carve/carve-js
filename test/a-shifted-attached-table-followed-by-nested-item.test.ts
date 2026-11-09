import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a nested marker in an item after its attached table has a shifted row (carve-js#4768)', () => {
  expect(carveToHtml('- [ ] - +\n      | a |\n     | b |\n\n        - z\n').trim()).toBe(
    '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ul>\n      <li>\n        <table>\n          <tbody>\n            <tr><td>a</td></tr>\n            <tr><td>b</td></tr>\n          </tbody>\n        </table>\n        <ul>\n          <li>z</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>')
})
