import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an attached colon block ends at its host boundary (carve#4717)', () => {
  it('keeps the next item a sibling even when a closer follows', () => {
    expect(carveToHtml('- +\n:::\n- b\n:::\n')).toBe(
      '<ul>\n  <li>\n    <div>\n\n    </div>\n  </li>\n  <li>b</li>\n</ul>\n<div>\n\n</div>',
    )
  })

  it('ends an admonition at the next ordered item', () => {
    expect(carveToHtml('1. +\n::: note\nx\n2. b\n:::\n')).toBe(
      '<ol>\n  <li>\n    <aside class="admonition note" aria-label="Note">\n      <p>x</p>\n    </aside>\n  </li>\n  <li>b</li>\n</ol>\n<div>\n\n</div>',
    )
  })
})
