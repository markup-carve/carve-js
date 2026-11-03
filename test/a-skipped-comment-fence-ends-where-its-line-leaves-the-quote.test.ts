import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#4870: the blank line has no quote prefix, so it ends the span and the quote.
describe('a skipped comment fence ends where its line leaves the quote', () => {
  it('refuses the plus, which stays a letter', () => {
    expect(carveToHtml('> - +\n> %%%\n\n> %%%\n> text\n').trim()).toBe(
      '<blockquote>\n  <ul>\n    <li></li>\n  </ul>\n</blockquote>\n<blockquote>\n\n</blockquote>')
  })

  it('still attaches past a fence that closes inside the quote', () => {
    expect(carveToHtml('> - +\n> %%%\n> c\n> %%%\n> text\n')).toContain('<li>text</li>')
  })
})
