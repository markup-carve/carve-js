import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'

/**
 * Importing `<x>C</x>` for an unsupported `x` gives the document `C` gives in
 * the same position, plus one `element-unwrapped` row per wrapper
 * (markup-carve/carve#2341).
 */
const shapes: Array<{ name: string; wrapped: string; bare: string; rows: string[] }> = [
  {
    name: 'blocks under a custom element',
    wrapped: '<react-app><div><h1>Title</h1><p>Body</p><ul><li>one</li></ul></div></react-app>',
    bare: '<div><h1>Title</h1><p>Body</p><ul><li>one</li></ul></div>',
    rows: ['/react-app[1]'],
  },
  {
    name: 'inline context stays inline',
    wrapped: '<p>a <tool-tip>b <em>c</em></tool-tip> d</p>',
    bare: '<p>a b <em>c</em> d</p>',
    rows: ['/p[1]/tool-tip[2]'],
  },
  {
    name: 'mixed text and blocks',
    wrapped: '<x-a>loose text<p>para</p>more</x-a>',
    bare: 'loose text<p>para</p>more',
    rows: ['/x-a[1]'],
  },
  {
    name: 'a non-hyphenated unknown tag',
    wrapped: '<foo><h2>H</h2><pre><code>x = 1</code></pre></foo>',
    bare: '<h2>H</h2><pre><code>x = 1</code></pre>',
    rows: ['/foo[1]'],
  },
  {
    name: 'two nested unknown elements',
    wrapped: '<p>before</p><x-a><x-b><blockquote><p>q</p></blockquote></x-b></x-a><p>after</p>',
    bare: '<p>before</p><blockquote><p>q</p></blockquote><p>after</p>',
    rows: ['/x-a[2]', '/x-a[2]/x-b[1]'],
  },
  {
    name: 'inside a list item',
    wrapped: '<ul><li><x-a><p>one</p><p>two</p></x-a></li></ul>',
    bare: '<ul><li><p>one</p><p>two</p></li></ul>',
    rows: ['/ul[1]/li[1]/x-a[1]'],
  },
]

describe('an unsupported element unwraps in place', () => {
  for (const shape of shapes) {
    it(shape.name, () => {
      const wrapped = htmlToCarve(shape.wrapped)
      const bare = htmlToCarve(shape.bare)
      expect(wrapped.value).toBe(bare.value)
      expect(htmlToAst(shape.wrapped).value).toEqual(htmlToAst(shape.bare).value)
      expect(bare.report.diagnostics).toEqual([])
      expect(wrapped.report.diagnostics.map((d) => [d.code, d.severity, d.fidelity, d.path])).toEqual(
        shape.rows.map((path) => ['element-unwrapped', 'info', 'degraded', path]),
      )
    })
  }

  it('keeps an inline run around the wrapper one paragraph', () => {
    expect(htmlToCarve('a <x-a>b<p>c</p>d</x-a> e').value).toBe(htmlToCarve('a b<p>c</p>d e').value)
  })

  it('charges inline content inside a spliced wrapper at its real depth', () => {
    expect(() => htmlToCarve('<x-a><hr><em><em>x</em></em></x-a>', { maxDepth: 3 })).toThrow(/depth limit/)
  })

  it('still drops an empty one', () => {
    const result = htmlToCarve('<p>a</p><x-a></x-a>')
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['element-dropped'])
  })
})
