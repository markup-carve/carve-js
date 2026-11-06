import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends a nested description verse at the ancestor item marker (#4560)', () => {
  expect(carveToHtml('- a\n  - b\n    :: t\n    : ::: |\n      v\n      %%%\n: d\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <dl>\n          <dt>t</dt>\n          <dd>\n            <div class="line-block">\n              <p>v</p>\n            </div>\n          </dd>\n        </dl>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>: d</p>',
  )
})
