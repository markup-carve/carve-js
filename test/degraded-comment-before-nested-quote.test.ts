import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('degraded comment before a nested quote', () => {
  it('keeps a flush-left lazy line inside the quote', () => {
    expect(carveToHtml('- %%%\n   > x\nl\n')).toBe(
      '<ul>\n  <li>\n    <blockquote><p>x\nl</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('keeps the two-percent control inside the quote', () => {
    expect(carveToHtml('- %%\n   > x\nl\n')).toBe(
      '<ul>\n  <li>\n    <blockquote><p>x\nl</p></blockquote>\n  </li>\n</ul>',
    )
  })
})
