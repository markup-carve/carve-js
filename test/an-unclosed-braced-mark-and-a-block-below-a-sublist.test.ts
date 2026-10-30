import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a braced opener with no closer of its kind', () => {
  it.each([
    ['{*x /{=a={t="*}"} a_ b*}', '<p><strong>x /{<mark t="*}">a</mark> a_ b</strong></p>'],
    ['{*{=a={t="*}"} b*}', '<p><strong>{<mark t="*}">a</mark> b</strong></p>'],
    ['{/x {_a_{t="/}"} b/}', '<p><em>x {<u t="/}">a</u> b</em></p>'],
  ])('lets its mark pair bare and own the block: %s', (source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })

  it('stays a braced span when its closer follows', () => {
    expect(carveToHtml('{=a=}').trim()).toBe('<p><mark>a</mark></p>')
  })
})

describe('an attribute line below a sublist column', () => {
  const loose = '<ul>\n  <li><p>a</p>\n    <ul>\n      <li>b</li>\n    </ul>\n    <p x="">p</p>\n  </li>\n</ul>'

  it.each([
    ['- a\n  - b\n\n  {x}\n  p\n'],
    ['- a\n  - b\n\n  {x}\n    p\n'],
    ['- a\n  - b\n\n  {x}\n      p\n'],
  ])('ends the sublist, so the blank loosens the item: %j', (source) => {
    expect(carveToHtml(source).trim()).toBe(loose)
  })

  it('reads the same inside a quote', () => {
    expect(carveToHtml('> - a\n>   - b\n>\n>   {x}\n>     p\n').trim()).toContain('<li><p>a</p>')
  })
})
