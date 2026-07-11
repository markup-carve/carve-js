import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('non-HTML renderers show autolink content, not the href', () => {
  it('markdown: email autolink shows the address, keeps mailto: target', () => {
    expect(carveToMarkdown('<me@example.com>').trim()).toBe('[me@example.com](mailto:me@example.com)')
  })
  it('markdown: URI autolink keeps its scheme', () => {
    expect(carveToMarkdown('<https://example.com>').trim()).toBe('[https://example.com](https://example.com)')
  })
  it('plain: email autolink shows the bare address', () => {
    expect(carveToPlainText('<me@example.com>').trim()).toBe('me@example.com')
  })
  it('ansi: email autolink shows the bare address', () => {
    expect(strip(carveToAnsi('<me@example.com>')).trim()).toBe('me@example.com')
  })
})
