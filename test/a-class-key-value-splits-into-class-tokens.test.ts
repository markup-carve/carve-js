import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

// A `class=V` value splits on ASCII whitespace into one class per token, so the
// CARVE-P4-002 dedup compares tokens (markup-carve/carve#4205). A typed div's
// or admonition's derived classes and the authored ones are one list
// (markup-carve/carve#4203).

const html = (source: string) => carveToHtml(source).trim()

describe('a class key-value', () => {
  it.each([
    ['dedups a token against a dot class', '{class="a b" .a}\npara', '<p class="a b">para</p>'],
    ['dedups a dot class against a token', '[x]{class="a b" .b}', '<p><span class="a b">x</span></p>'],
    ['dedups tokens inside one value', '[x]{class="a  b a"}', '<p><span class="a b">x</span></p>'],
    ['merges across stacked attribute lines', '{.b}\n{class="a b"}\npara', '<p class="b a">para</p>'],
    ['keeps an empty value as one entry', '{class=""}\npara', '<p class="">para</p>'],
    ['hardens each token on its own', '{class="javascript:x y"}\npara', '<p class="y">para</p>'],
  ])('%s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('parses to one class per token', () => {
    const doc = parse('{class="a\tb" .a}\npara\n')
    expect(doc.children[0]!.attrs?.classes).toEqual(['a', 'b', 'a'])
  })
})

describe('a typed block class', () => {
  it.each([
    ['an admonition', '{.note .admonition}\n::: note\n42\n:::', '<aside class="admonition note" aria-label="Note">\n  <p>42</p>\n</aside>'],
    ['a typed div', '{.calculation}\n::: calculation\n42\n:::', '<div class="calculation">\n  <p>42</p>\n</div>'],
    ['a class value over an admonition', '{class="admonition note x"}\n::: note\n42\n:::', '<aside class="admonition note x" aria-label="Note">\n  <p>42</p>\n</aside>'],
  ])('is not repeated on %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})
