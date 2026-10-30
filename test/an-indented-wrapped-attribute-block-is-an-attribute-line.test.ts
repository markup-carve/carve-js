import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#4089: indentation in front of the opener does not change what it opens.
describe('an indented wrapped attribute block is an attribute line', () => {
  it.each([
    ['a\n {.c\n }\npara\n', '<p>a</p>\n<p class="c">para</p>'],
    [' {.c\n }\npara\n', '<p class="c">para</p>'],
    ['- a\n   {.c\n   }\npara\n', '<ul>\n  <li>a</li>\n</ul>\n<p>para</p>'],
    ['- a\n   {.c\n   }\n  para\n', '<ul>\n  <li>a\n    <p class="c">para</p>\n  </li>\n</ul>'],
    [':: t\n: a\n   {.c\n}\npara\n', '<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n</dl>\n<p>para</p>'],
    [':: t\n: a\n {.c\n}\n  - x\n', '<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n</dl>\n<ul class="c">\n  <li>x</li>\n</ul>'],
    ['> a\n>  {.c\n> }\n> para\n', '<blockquote>\n  <p>a</p>\n  <p class="c">para</p>\n</blockquote>'],
  ])('%j', (source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })

  it('needs the quote prefix on its continuation line', () => {
    expect(carveToHtml('> a\n>  {.c\n}\npara\n').trim()).toBe('<blockquote><p>a\n{.c\n}\npara</p></blockquote>')
  })

  it('stays text when it never closes', () => {
    expect(carveToHtml('a\n {.c\n\npara\n').trim()).toBe('<p>a\n{.c</p>\n<p>para</p>')
  })
})
