import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('reference-looking lazy line in a nested quote', () => {
  it('reads the line as a reference definition', () => {
    expect(carveToHtml('  - d\n    > b\n [r]: l\n')).toBe(
      '<ul>\n  <li>d\n    <blockquote><p>b</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('keeps an ordinary lazy line as quoted text', () => {
    expect(carveToHtml('  - d\n    > b\n q\n')).toBe(
      '<ul>\n  <li>d\n    <blockquote><p>b\nq</p></blockquote>\n  </li>\n</ul>',
    )
  })
})
