import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('quoted first-block list item', () => {
  it('folds an unprefixed paragraph or list line into the refused plus', () => {
    expect(carveToHtml('> - +\nflush\n')).toBe('<blockquote>\n  <ul>\n    <li>+\nflush</li>\n  </ul>\n</blockquote>')
    expect(carveToHtml('> - +\n- b\n')).toBe('<blockquote>\n  <ul>\n    <li>+</li>\n  </ul>\n</blockquote>\n<ul>\n  <li>b</li>\n</ul>')
  })

  it('keeps a prefixed line inside the item', () => {
    expect(carveToHtml('> - +\n> flush\n')).toContain('<li>flush</li>')
  })
})
