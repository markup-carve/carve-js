import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a definition-shaped lazy line in a nested bare verse after a hidden span (carve#5308)', () => {
  expect(carveToHtml('- a\n  - b\n    ::: |\n      v\n      %%%\n: d\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <div class="line-block">\n          <p>&nbsp;&nbsp;v<br>\n: d</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
})

it('passes the same lazy claim through three item levels', () => {
  expect(carveToHtml('- a\n  - b\n    - c\n      ::: |\n        v\n        %%%\n: d\n')).toContain(
    '<p>&nbsp;&nbsp;v<br>\n: d</p>',
  )
})

it('does not treat a verse-shaped comment payload as an open verse', () => {
  expect(carveToHtml('- a\n  - b\n    %%%\n      ::: |\n: d\n    %%%\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>: d</p>',
  )
})
