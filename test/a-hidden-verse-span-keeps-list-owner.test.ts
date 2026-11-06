import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a later verse line in its nested item after a hidden span (carve#5299)', () => {
  expect(carveToHtml('- a\n  - b\n    :: t\n    : ::: |\n      v\n      %%%\n    %% c\n    x\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <dl>\n          <dt>t</dt>\n          <dd>\n            <div class="line-block">\n              <p>v<br>\nx</p>\n            </div>\n          </dd>\n        </dl>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
})

it('keeps a blank-separated sibling paragraph in its item after a hidden span', () => {
  expect(carveToHtml('- host\n  :: t\n  : ::: |\n    v\n    %%%\n  %% c\n  more\n\n  end\n')).toBe(
    '<ul>\n  <li><p>host</p>\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <div class="line-block">\n          <p>v<br>\nmore</p>\n        </div>\n      </dd>\n    </dl>\n    <p>end</p>\n  </li>\n</ul>',
  )
})

it('control: keeps the same sibling after a verse without a hidden span', () => {
  expect(carveToHtml('- host\n  :: t\n  : ::: |\n    v\n  more\n\n  end\n')).toContain('    <p>end</p>')
})
