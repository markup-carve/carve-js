// The rulings of the 0.2 specification that the HTML importer follows, each test named by its clause.
import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

describe('block images', () => {
  it('C2-H-020: a paragraph of one image with attributes is a block image paragraph that keeps them', () => {
    const result = importDocument('<p id="i" class="c"><img src="x.png" alt="a"></p>\n<p lang="de"><img src="y.png" alt="b"></p>\n',
      { from: 'html' })
    expect(result.document.children).toMatchObject([
      { type: 'paragraph', role: 'image', attrs: { id: 'i', classes: ['c'] } },
      { type: 'paragraph', role: 'image', lang: 'de' },
    ])
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([])
  })
})

describe('destinations the importer cannot keep', () => {
  it('C2-W-011: a link or image whose URL is denied becomes its text, so the writer has a spelling and reports no loss', () => {
    const cases: [string, 'html' | 'markdown' | 'djot', string][] = [
      ['<p><a href="javascript:x">t</a></p>\n', 'html', 't\n'],
      ['<p>a <img src="javascript:x" alt="i"> <a>t</a></p>\n', 'html', 'a i t\n'],
      ['[t](javascript:x) and ![i](javascript:y)\n', 'markdown', 't and i\n'],
      ['[t](javascript:x)\n\n![i](javascript:y)\n', 'djot', 't\n\ni\n'],
    ]
    for (const [input, from, source] of cases) {
      const result = importDocument(input, { from })
      expect(result.source, input).toBe(source)
      expect(result.diagnostics.map((entry) => entry.code), input).not.toContain('field-unspellable')
    }
  })

  it('C2-W-011: attributes of a link with no destination stay on a span', () => {
    const result = importDocument('<p><a id="k" href="javascript:x">t</a></p>\n', { from: 'html' })
    expect(result.document.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'span', attrs: { id: 'k' } }] })
  })
})
