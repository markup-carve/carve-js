import { describe, expect, it } from 'vitest'
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

  it('passes multiline Djot block braces through with their columns', () => {
    const source = '{% x\ny %}\n\n{% x\n  y %}\n\n{#one\nkey=1}\nalpha\n\n{#two\n  key=2}\nbeta\n'
    expect(djotToCarve(source)).toBe(source)
  })
})
