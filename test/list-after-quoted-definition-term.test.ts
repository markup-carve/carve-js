import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('list marker after a quoted definition term', () => {
  it('opens a sibling list without a quote marker', () => {
    expect(carveToHtml('> :: c\n- t\n')).toBe(
      '<blockquote>\n  <dl>\n    <dt>c</dt>\n  </dl>\n</blockquote>\n<ul>\n  <li>t</li>\n</ul>',
    )
  })

  it('opens a list inside the quote when marked', () => {
    expect(carveToHtml('> :: c\n> - t\n')).toBe(
      '<blockquote>\n  <dl>\n    <dt>c</dt>\n  </dl>\n  <ul>\n    <li>t</li>\n  </ul>\n</blockquote>',
    )
  })
})
