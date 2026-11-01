import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

const imported = (markdown: string) => markdownToCarve(markdown + '\n').replace(/\n$/, '')
const html = (carve: string) => carveToHtml(carve).trim()

describe('Markdown import escapes a slash only where it could delimit emphasis', () => {
  it.each([
    ['*usr/local*', '{/usr/local/}', '<p><em>usr/local</em></p>'],
    ['*a/b* and *italic **bold***', '{/a/b/} and /italic *bold*/', '<p><em>a/b</em> and <em>italic <strong>bold</strong></em></p>'],
    ['a/b *x* c/d', 'a/b /x/ c/d', '<p>a/b <em>x</em> c/d</p>'],
    ['*x* 1/2 and/or', '/x/ 1/2 and/or', '<p><em>x</em> 1/2 and/or</p>'],
    ['*x* a / b', '/x/ a / b', '<p><em>x</em> a / b</p>'],
    ['_x_\na/b', '/x/\na/b', '<p><em>x</em>\na/b</p>'],
    ['<em>x</em> a/b', '/x/ a/b', '<p><em>x</em> a/b</p>'],
  ])('leaves %j bare', (markdown, carve, rendered) => {
    expect(imported(markdown)).toBe(carve)
    expect(html(carve)).toBe(rendered)
  })

  // Each of these loses or gains emphasis once its backslashes are removed.
  it.each([
    ['*x* /a/', '/x/ \\/a\\/', '<p><em>x</em> /a/</p>'],
    ['/a/ *x*', '\\/a\\/ /x/', '<p>/a/ <em>x</em></p>'],
    ['*a /b/ c*', '/a \\/b\\/ c/', '<p><em>a /b/ c</em></p>'],
    ['*/usr/*', '{/\\/usr\\//}', '<p><em>/usr/</em></p>'],
    ['see /x *y* z/ end', 'see \\/x /y/ z\\/ end', '<p>see /x <em>y</em> z/ end</p>'],
    ['*x* a/b /c/', '/x/ a/b \\/c\\/', '<p><em>x</em> a/b /c/</p>'],
  ])('keeps the delimiting slashes of %j escaped', (markdown, carve, rendered) => {
    expect(imported(markdown)).toBe(carve)
    expect(html(carve)).toBe(rendered)
    // Braced emphasis delimits on its own, so only the unbraced rows need the escapes.
    if (!carve.includes('{/')) expect(html(carve.replaceAll('\\/', '/'))).not.toBe(rendered)
  })

  it('keeps a slash beside a non-ASCII letter escaped, as the parser opens there', () => {
    expect(imported('*x* é/b')).toBe('/x/ é\\/b')
  })

  it('leaves a link destination and an intraword label slash alone on a line with emphasis', () => {
    const carve = imported('*see* [a/b](http://e.com/x/y) and c/d /e/')
    expect(carve).toBe('/see/ [a/b](http://e.com/x/y) and c/d \\/e\\/')
    expect(html(carve)).toBe('<p><em>see</em> <a href="http://e.com/x/y">a/b</a> and c/d /e/</p>')
  })

  it('returns the corpus sources byte for byte through Markdown', () => {
    const source = '/usr/local/\n'
    expect(html(markdownToCarve(carveToMarkdown(source)))).toBe(html(source))
  })
})
