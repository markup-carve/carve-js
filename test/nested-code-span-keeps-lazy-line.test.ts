import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('open code span in a nested list item', () => {
  it('takes a flush-left lazy line', () => {
    expect(carveToHtml('- - a\n    ```` x\ntail\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n<code> x\ntail</code></li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('takes a line at the child indentation', () => {
    expect(carveToHtml('- - a\n    ```` x\n    tail\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n<code> x\ntail</code></li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
