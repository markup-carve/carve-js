import { describe, expect, it } from 'vitest'
import { declaredPairCount } from './helpers/corpus-population.js'

const source = "````text\n::: compare\n```carve\nfake\n```\n```html\nfake\n```\n:::\n````\n::: compare no-render\n````carve\n::: compare\n```html\nliteral\n```\n:::\n````\n```html\n<p>first</p>\n```\n```carve\nsecond\n```\n```html\n<p>second</p>\n```\n:::\n"

describe('source-derived corpus population', () => {
  it('counts multiple pairs and ignores literal fenced markup', () => {
    expect(declaredPairCount(source)).toBe(2)
    expect(declaredPairCount(source.replaceAll('\n', '\r\n'))).toBe(2)
  })
  it.each(["::: compare\n:::", "::: compare\n```carve\nx\n```\n:::", "::: compare\n```html\nx\n```\n:::", "::: compare"])('refuses invalid source: %s', (invalid) => {
    expect(() => declaredPairCount(invalid)).toThrow(/unpaired|unclosed/)
  })
})
