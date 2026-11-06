import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5318: a comment line below a nested item's marker-line `%%%` span is span payload, so the
// closer below the item's column ends that span and opens no new one (PART 0 S1, PART 9 §28).
it('keeps the line after the closer in the outer item', () => {
  expect(carveToHtml('- i\n  - %%%\n    n\n%% c\n  %%%\n  zz\n').trim()).toBe(
    '<ul>\n  <li>i\n    <ul>\n      <li></li>\n    </ul>\n    zz\n  </li>\n</ul>',
  )
})

it('keeps it with a closer at column 0 and two comment lines', () => {
  expect(carveToHtml('- i\n  . %%%\n%% c\n%% d\n%%%\n  zz\n').trim()).toBe(
    '<ul>\n  <li>i\n    <ol>\n      <li></li>\n    </ol>\n    zz\n  </li>\n</ul>',
  )
})
