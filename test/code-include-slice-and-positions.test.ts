import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderHtml, resolve, toAstJson } from '../src/index.js'

function included(directive: string, path: string, content: string) {
  const doc = expandIncludes(parse(directive, { positions: true }), directive, {
    resolve: name => name === path ? { source: content, id: path } : null,
  }).doc
  return { html: renderHtml(resolve(doc)), ast: toAstJson(doc) }
}

function pos(result: ReturnType<typeof included>) {
  return result.ast.children[0]?.pos
}

const at = (file: string, startLine: number, startColumn: number, startOffset: number,
  endLine: number, endColumn: number, endOffset: number) => ({
  file, startLine, startColumn, startOffset, endLine, endColumn, endOffset,
})

describe('code include slices and positions', () => {
  it('preserves each payload line, including trailing blank lines', () => {
    const whole = included('{{ t.txt @code }}', 't.txt', 'x\n\n\n')
    const sliced = included('{{ t.txt @lines:1-3 @code }}', 't.txt', 'x\n\n\n')
    expect(whole.html).toBe('<pre><code>x\n\n\n</code></pre>')
    expect(sliced.html).toBe(whole.html)
    expect(pos(whole)).toEqual(at('t.txt', 1, 1, 0, 3, 1, 3))
    expect(pos(sliced)).toEqual(pos(whole))
    const blank = included('{{ t.txt @lines:2-2 @code }}', 't.txt', 'x\n\n\n')
    expect(blank.html).toBe('<pre><code>\n</code></pre>')
    expect(pos(blank)).toEqual(at('t.txt', 2, 1, 2, 2, 1, 2))
  })

  it('positions nonempty, empty, BOM, and CRLF code selections', () => {
    const simple = included('{{ s.js @code:js }}', 's.js', 'a\nbb\n')
    expect(simple.html).toBe('<pre><code class="language-js">a\nbb\n</code></pre>')
    expect(pos(simple)).toEqual(at('s.js', 1, 1, 0, 2, 3, 4))
    expect(pos(included('{{ s.js @code }}', 's.js', 'a\r\nbb\r\n'))).toEqual(at('s.js', 1, 1, 0, 2, 3, 5))
    expect(pos(included('{{ s.js @code }}', 's.js', 'a\rbb\r'))).toEqual(at('s.js', 1, 1, 0, 2, 3, 4))
    expect(pos(included('{{ s.js @code }}', 's.js', '\uFEFFa\n'))).toEqual(at('s.js', 1, 2, 1, 1, 3, 2))
    expect(pos(included('{{ s.js @code }}', 's.js', '😀\n'))).toEqual(at('s.js', 1, 1, 0, 1, 2, 1))
    const empty = included('{{ e.txt @code }}', 'e.txt', '')
    expect(empty.html).toBe('<pre><code></code></pre>')
    expect(pos(empty)).toEqual(at('e.txt', 1, 1, 0, 1, 1, 0))
    const bom = included('{{ e.txt @code }}', 'e.txt', '\uFEFF')
    expect(bom.html).toBe(empty.html)
    expect(pos(bom)).toEqual(at('e.txt', 1, 2, 1, 1, 2, 1))
  })

  it('positions selected regions, including empty regions', () => {
    const source = '// #region a\nx\n\n// #endregion a\n// #region b\n\n// #endregion b\n// #region c\n// #endregion c\n'
    for (const [name, html, expected] of [
      ['a', '<pre><code>x\n\n</code></pre>', at('r.js', 2, 1, 13, 3, 1, 15)],
      ['b', '<pre><code>\n</code></pre>', at('r.js', 6, 1, 45, 6, 1, 45)],
      ['c', '<pre><code></code></pre>', at('r.js', 9, 1, 75, 9, 1, 75)],
    ] as const) {
      const result = included(`{{ r.js @region:${name} @code }}`, 'r.js', source)
      expect(result.html).toBe(html)
      expect(pos(result)).toEqual(expected)
    }
  })

  it('keeps original CRLF offsets in Carve line and region selections', () => {
    const lines = included('{{ c.crv @lines:1-3 }}', 'c.crv', 'one\r\n\r\ntwo\r\n')
    expect(lines.html).toBe('<p>one</p>\n<p>two</p>')
    expect(lines.ast.children[1]?.pos).toEqual(at('c.crv', 3, 1, 7, 3, 4, 10))
    const region = included('{{ c.crv @region:a }}', 'c.crv', '%% #region a\r\none\r\n\r\ntwo\r\n%% #endregion a\r\n')
    expect(region.html).toBe('<p>one</p>\n<p>two</p>')
    expect(region.ast.children[1]?.pos?.startOffset).toBe(21)
    expect(region.ast.children[1]?.pos?.endOffset).toBe(24)
  })

  it('keeps code include positions when a table attribute converts the block', () => {
    const result = included('{table}\n{{ data.csv @code:csv }}', 'data.csv', 'a,b\r\n1,2\r\n')
    expect(result.html).toContain('<table>')
    expect(result.ast.children[0]?.pos).toEqual(at('data.csv', 1, 1, 0, 2, 4, 8))
  })
})
