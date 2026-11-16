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
