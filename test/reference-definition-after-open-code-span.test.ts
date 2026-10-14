import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('reference definition after an open code span', () => {
  it('interrupts the list paragraph and leaves the code empty', () => {
    expect(carveToHtml('- x\n```\n  [r]: l\n')).toBe(
      '<ul>\n  <li>x\n<code></code></li>\n</ul>',
    )
  })

  it('keeps ordinary text in the code span', () => {
    expect(carveToHtml('- x\n```\n  plain\n')).toBe(
      '<ul>\n  <li>x\n<code>\nplain</code></li>\n</ul>',
    )
  })
})
