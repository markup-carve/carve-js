import { describe, it, expect } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

const html = (md: string): string => carveToHtml(markdownToCarve(md)).replace(/>\n\s*/g, '>').replace(/\n\s*</g, '<')

describe('the Markdown importer pairs emphasis as CommonMark does', () => {
  // Rules 9 and 10 read the original run lengths (markup-carve/carve#4919).
  it.each([
    ['a***b* c*\n', '<p>a*<em><em>b</em> c</em></p>'],
    ['**!*!**\n', '<p><strong>!*!</strong></p>'],
    ['**(*)**\n', '<p><strong>(*)</strong></p>'],
    ['*a**a_\n', '<p>*a**a_</p>'],
    ['*!**a**\n', '<p>*!<strong>a</strong></p>'],
  ])('%j', (md, expected) => {
    expect(html(md)).toBe(expected)
  })

  it('writes an unpaired star inside strong text escaped', () => {
    expect(markdownToCarve('**!*!**\n')).toBe('*!\\*!*\n')
  })

  it('leaves unpaired runs Carve cannot pair bare', () => {
    expect(markdownToCarve('- **open\n- **closed**\n')).toBe('- **open\n- *closed*\n')
    expect(markdownToCarve('foo__bar__baz\n')).toBe('foo__bar__baz\n')
  })

  // A reference that decodes to a space is the span's edge (markup-carve/carve#4942).
  it.each([
    ['*&#x20;*\n', '{/ /}\n', '<p><em> </em></p>'],
    ['**&#32;a**\n', '{* a*}\n', '<p><strong> a</strong></p>'],
    ['x *a&#9;* y\n', 'x {/a\t/} y\n', '<p>x <em>a\t</em> y</p>'],
  ])('%j', (md, carve, expected) => {
    expect(markdownToCarve(md)).toBe(carve)
    expect(html(md)).toBe(expected)
  })

  // A block inside a list item or quote ends the paragraph (markup-carve/carve#4934).
  it.each([
    ['- _t\n  # h\n  t_\n', '<ul><li>_t<h1 id="h">h</h1>t_</li></ul>'],
    ['> *t\n> # h\n> t*\n', '<blockquote><p>*t</p><h1 id="h">h</h1><p>t*</p></blockquote>'],
    ['- _t\n  > q\n  t_\n', '<ul><li>_t<blockquote><p>q\nt_</p></blockquote></li></ul>'],
    ['> _t\n> ***\n> t_\n', '<blockquote><p>_t</p><hr><p>t_</p></blockquote>'],
    ['- > *a\n  b*\n', '<ul><li><blockquote><p><em>a\nb</em></p></blockquote></li></ul>'],
  ])('%j', (md, expected) => {
    expect(html(md)).toBe(expected)
  })
})

describe('the Markdown importer keeps periods as periods', () => {
  // CommonMark has no smart punctuation (markup-carve/carve#4924).
  it.each([
    ['Wait...\n', 'Wait\\.\\.\\.\n', '<p>Wait...</p>'],
    ['a....b\n', 'a\\.\\.\\.\\.b\n', '<p>a....b</p>'],
    ['`a...`\n', '`a...`\n', '<p><code>a...</code></p>'],
  ])('%j', (md, carve, expected) => {
    expect(markdownToCarve(md)).toBe(carve)
    expect(html(md)).toBe(expected)
  })
})
