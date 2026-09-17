import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, fromAstJson, parse, renderCarve, renderHtml, renderMarkdown, toAstJson } from '../src/index.js'

// carve#2083: a substitution's halves are inline content, so they carry nodes,
// resolution and positions. The node holds them in `old` and `new`, the shape
// `insert` and `delete` use for `children` (ruling on carve-js#1827).

const strip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, inner) => (key === 'pos' || key === 'srcByteLength' ? undefined : inner)))

describe('a substitution', () => {
  it('parses both halves as inline content', () => {
    expect(strip(toAstJson(parse('{~/old/~>*new*~}')).children[0])).toStrictEqual({
      type: 'paragraph',
      children: [
        {
          type: 'substitution',
          old: [{ type: 'emphasis', children: [{ type: 'text', value: 'old' }] }],
          new: [{ type: 'strong', children: [{ type: 'text', value: 'new' }] }],
        },
      ],
    })
  })

  it('gives each half a position', () => {
    const node = toAstJson(parse('{~a~>b~}')).children[0] as unknown as { children: Array<{ old: Array<{ pos?: unknown }>; new: Array<{ pos?: unknown }> }> }
    const substitution = node.children[0]!
    expect(substitution.old[0]!.pos).toMatchObject({ startOffset: 2, endOffset: 3 })
    expect(substitution.new[0]!.pos).toMatchObject({ startOffset: 5, endOffset: 6 })
  })

  it('resolves a reference in either half', () => {
    expect(carveToHtml('{~[a][r]~>[b][r]~}\n\n[r]: /u\n').trim()).toBe('<p><del><a href="/u">a</a></del><ins><a href="/u">b</a></ins></p>')
  })

  it('renders both halves on every target', () => {
    const document = parse('{~/old/~>*new*~}')
    expect(renderHtml(document)).toBe('<p><del><em>old</em></del><ins><strong>new</strong></strong></ins></p>'.replace('</strong></strong>', '</strong>'))
    expect(renderMarkdown(document)).toBe('<del>*old*</del><ins>**new**</ins>\n')
  })

  it('writes both halves back', () => {
    expect(renderCarve(parse('{~/old/~>*new*~}'))).toBe('{~/old/~>*new*~}\n')
    expect(carveToCarve('{~/old/~>*new*~}\n')).toBe('{~/old/~>*new*~}\n')
  })

  it('round-trips through the AST JSON', () => {
    const document = parse('{~/old/~>*new*~}')
    const ingested = fromAstJson(JSON.parse(JSON.stringify(toAstJson(document))))
    expect(renderHtml(ingested)).toBe(renderHtml(document))
    expect(renderCarve(ingested)).toBe(renderCarve(document))
  })

  it('refuses the old string fields on ingest', () => {
    expect(() =>
      fromAstJson({
        type: 'document',
        srcByteLength: 0,
        children: [{ type: 'paragraph', children: [{ type: 'substitution', oldText: 'a', newText: 'b' } as never] }],
      } as never),
    ).toThrow()
  })
})
