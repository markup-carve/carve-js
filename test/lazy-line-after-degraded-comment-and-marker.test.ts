import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('lazy line after a degraded comment and nested marker', () => {
  it('stays in the open item paragraph', () => {
    expect(carveToHtml('- %%%\n    * \n y\n')).toBe('<ul>\n  <li>*\ny</li>\n</ul>')
  })

  it('keeps an indented follower in the item', () => {
    expect(carveToHtml('- %%%\n    * \n    y\n')).toBe('<ul>\n  <li>*\ny</li>\n</ul>')
  })
})
