import { describe, expect, it } from 'vitest'
import { parse as parseDjot, renderHTML } from '@djot/djot'
import { carveToHtml, djotToCarve, parse, renderCarve } from '../src/index.js'

describe('block brace continuations pass the opening column', () => {
  it.each([
    ['{.a\n  #x}\npara', '<p class="a" id="x">para</p>'],
    ['{.a\n  }\npara', '<p class="a">para</p>'],
    ['{.a\n#x}\npara', '<p>{.a\n#x}\npara</p>'],
    ['{.a\n}\npara', '<p>{.a\n}\npara</p>'],
    ['{% x\ny %}\n# b', '<p>{% x\ny %}\n# b</p>'],
    ['- item\n\n  {.a\n  #x}\n  para', '<ul>\n  <li><p>item</p>\n    <p>{.a\n#x}\npara</p>\n  </li>\n</ul>'],
    ['- item\n\n   {.a\n   #x}\n  - sibling', '<ul>\n  <li><p>item</p>\n    <p>{.a\n#x}\n- sibling</p>\n  </li>\n</ul>'],
    ['- item\n\n  {.a\n  .b\n  #x}\n  - sibling', '<ul>\n  <li><p>item</p>\n    <p>{.a\n.b\n#x}\n- sibling</p>\n  </li>\n</ul>'],
    ['  - b\n    > q\n> > q\n> > {.k\ntail\n> > #x}\ntail\n  lazy\n', '<ul>\n  <li>b\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>\n<blockquote>\n  <blockquote><p>q\n{.k\ntail\n<span class="tag"><strong>#x</strong></span>}\ntail\nlazy</p></blockquote>\n</blockquote>'],
  ])('renders %j as ruled', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('indents every wrapped attribute line written from an AST', () => {
    const document = parse('para')
    document.children[0]!.attrs = { keyValues: { title: 'a\nb' } }
    expect(renderCarve(document)).toBe('{title="a\n b"}\npara\n')
  })

  it('imports multiline Djot block braces as djot.js reads their columns', () => {
    const source = '{% x\ny %}\n\n{% x\n  y %}\n\n{#one\nkey=1}\nalpha\n\n{#two\n  key=2}\nbeta\n'
    const flat = (html: string) => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
    expect(flat(carveToHtml(djotToCarve(source)))).toBe(flat(renderHTML(parseDjot(source))))
    expect(djotToCarve('{#one\nkey=1}\nalpha\n')).toBe('{#one\nkey=1}\nalpha\n')
  })
})

// Each row is the spec model's output at carve main.
describe('a refused brace run in a container', () => {
  it.each([
    ['- a\n  - b\n\n    {.c\n    }\n  - s\n', '<ul>\n  <li>a\n    <ul>\n      <li><p>b</p>\n        <p>{.c\n}</p>\n      </li>\n      <li><p>s</p></li>\n    </ul>\n  </li>\n</ul>'],
    ['- a\n  - b\n\n  {.c\n  #d}\n\n  - c\n', '<ul>\n  <li><p>a</p>\n    <ul>\n      <li>b</li>\n    </ul>\n    <p>{.c\n#d}</p>\n    <ul>\n      <li>c</li>\n    </ul>\n  </li>\n</ul>'],
    ['- a\n  - b\n    {.c\n }\npara\n', '<ul>\n  <li>a\n    <ul>\n      <li>b\n{.c\n}\npara</li>\n    </ul>\n  </li>\n</ul>'],
    ['> {.a\n>  #x}\npara\n', '<blockquote>\n\n</blockquote>\n<p>para</p>'],
    ['> te{xt\n{\n> [a]: /u {.c}\n lazy\n', '<blockquote><p>te{xt\n{\nlazy</p></blockquote>'],
    [':: term\n: def\n  {.a\n }\npara\n', '<dl>\n  <dt>term</dt>\n  <dd>def\n{.a\n}\npara</dd>\n</dl>'],
    ['- item\n  {.a\n  #x}\n# h\n', '<ul>\n  <li>item\n{.a\n#x}</li>\n</ul>\n<section id="h">\n  <h1>h</h1>\n</section>'],
    ['{% x\ny %}\n\npara\n', '<p>{% x\ny %}</p>\n<p>para</p>'],
    ['- a\n\n{% c\nd %}\n\n- b\n', '<ul>\n  <li>a</li>\n</ul>\n<p>{% c\nd %}</p>\n<ul>\n  <li>b</li>\n</ul>'],
    ['[][d]\n{.a\n .b}\n- [d]: u\n', '<p><a href="u"></a></p>\n<ul class="a b">\n  <li></li>\n</ul>'],
    ['- {% x\n   y %}\n\n  para\n\n  para2\n- next\n', '<ul>\n  <li><p>para</p>\n    <p>para2</p>\n  </li>\n  <li><p>next</p></li>\n</ul>'],
    ['- {% x\n  y %}\n\n  para\n\n  para2\n- next\n', '<ul>\n  <li><p>{% x\ny %}</p>\n    <p>para</p>\n    <p>para2</p>\n  </li>\n  <li><p>next</p></li>\n</ul>'],
  ])('renders %j as the spec model', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('escapes literal text that would reparse as a wrapped attribute', () => {
    for (const value of ['{.x\n .y}', '{.x\n .y}\nhello', '{.a\n#x}\npara', '{.a\n#x}\n*bold*', '{.a\n#x} *b*']) {
      const document = parse('para')
      const paragraph = document.children[0]
      if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph')
      paragraph.children = [{ type: 'text', value }]
      const html = carveToHtml(renderCarve(document))
      expect(html).not.toContain('class=')
      expect(html).not.toContain('<strong>')
      expect(html).toContain('{')
    }
  })
})
