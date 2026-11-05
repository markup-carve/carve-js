import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('termless lazy description text', () => {
  it('keeps the item paragraph open across comment-shaped text', () => {
    expect(carveToHtml('- x\n: %%\n: %%%\nz\n')).toBe('<ul>\n  <li>x\n:\n:\nz</li>\n</ul>')
  })

  it('keeps an ordinary lazy description-shaped line in the paragraph', () => {
    expect(carveToHtml('- x\n: b\nz\n')).toBe('<ul>\n  <li>x\n: b\nz</li>\n</ul>')
  })
})
