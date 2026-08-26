import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

describe('a wrapped marker attribute leaves no paragraph open', () => {
  it('reclassifies a below-column line outside the item', () => {
    expect(carveToHtml('- {.a\n  .b}\ntail\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    )
  })

  it('matches the one-line spelling', () => {
    expect(carveToHtml('- {.a}\ntail\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    )
  })

  it('does not change an unclosed brace run into a block', () => {
    expect(carveToHtml('- {.a\ntail\n')).toBe('<ul>\n  <li>{.a\ntail</li>\n</ul>')
  })
})
