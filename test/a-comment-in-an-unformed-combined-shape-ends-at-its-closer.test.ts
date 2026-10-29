import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Each input renders like the same line with the comment deleted (markup-carve/carve#4042).
describe('a comment in a /* ... */ shape that does not form ends at its closer token', () => {
  it.each([
    ['/x /*a %% b*/ y', '<p><em>x /<strong>a</strong></em> y</p>'],
    ['*x /*a %% b*/ y*', '<p><strong>x /*a</strong>/ y*</p>'],
    ['p /q /*a b %% c d*/ e', '<p>p <em>q /<strong>a b</strong></em> e</p>'],
    ['/x /*a %% b*/{.c} y', '<p><em class="c">x /<strong>a</strong></em> y</p>'],
    ['/x\n/*a %% b*/ y', '<p><em>x\n/<strong>a</strong></em> y</p>'],
    ['- /x /*a %% b*/ y', '<ul>\n  <li><em>x /<strong>a</strong></em> y</li>\n</ul>'],
    ['/x /*a %% `b*/ c` d', '<p><em>x /<strong>a</strong></em> c<code> d</code></p>'],
    ['> /x /*a\n> b %% c*/ y', '<blockquote><p><em>x /<strong>a\nb</strong></em> y</p></blockquote>'],
    ['//*a %% b*/ y', '<p>//<strong>a</strong>/ y</p>'],
    ['/*a %% `b*/ c` d', '<p><strong><em>a</em></strong> c<code> d</code></p>'],
    ['/*a %% b\\*/.', '<p><strong><em>a</em></strong>.</p>'],
  ])('%j', (source, html) => {
    expect(carveToHtml(source + '\n').trim()).toBe(html)
  })

  it.each([
    ['a/*b %% c*/ d', '<p>a/*b</p>'],
    ['/x %% /*a*/ y/', '<p>/x</p>'],
    ['{/x /*a %% b*/}', '<p><em>x /*a</em></p>'],
  ])('a comment outside any shape still runs to the line end: %j', (source, html) => {
    expect(carveToHtml(source + '\n').trim()).toBe(html)
  })
})
