import { describe, expect, it } from 'vitest'
import { render, renderTree, resolveTree } from '../src/index.ts'
import { importDocument } from '../import/src/index.ts'

function back(source: string, roundtrip: boolean): boolean {
  const html = render(source, { roundtrip })
  const tree = importDocument(html, { from: 'html' }).document
  return renderTree(resolveTree(tree, { roundtrip })) === html
}

describe('carve#6832: a bare paragraph that would not import back keeps its <p>', () => {
  it('C2-H-018, C2-M-013: images separated by spaces, a soft break or a comment keep the <p>', () => {
    expect(render('- ![x](i.png) ![y](j.png)\n')).toBe('<ul>\n  <li><p><img src="i.png" alt="x"> <img src="j.png" alt="y"></p></li>\n</ul>')
    expect(render('1. ![x](i.png)\n   ![y](j.png)\n'))
      .toBe('<ol>\n  <li><p><img src="i.png" alt="x">\n<img src="j.png" alt="y"></p></li>\n</ol>')
    expect(render('- ![x](i.png){%% c %%}![y](j.png)\n')).toContain('<li><p><img src="i.png" alt="x">')
  })

  it('C2-H-018: a task item keeps the <p> after its box', () => {
    expect(render('- [ ] ![x](i.png)![y](j.png)\n')).toContain('aria-label="xy"> <p><img src="i.png" alt="x"><img src="j.png" alt="y"></p></li>')
  })

  it('C2-H-018, C2-M-012: a paragraph before a bare block image keeps its <p> in a quote and in a nested list', () => {
    expect(render('> - a\n>\n>   ![x](i.png)\n')).toContain('<li><p>a</p>\n      <img src="i.png" alt="x">')
    expect(render('- a\n  - b\n\n    ![x](i.png)\n')).toContain('<li><p>b</p>\n')
  })

  it('C2-H-034: text beside an image, a lone block image and a paragraph before a text paragraph stay bare', () => {
    expect(render('- a ![x](i.png)\n')).toBe('<ul>\n  <li>a <img src="i.png" alt="x"></li>\n</ul>')
    expect(render('- ![x](i.png)\n')).toBe('<ul>\n  <li>\n    <img src="i.png" alt="x">\n  </li>\n</ul>')
    expect(render('- a\n\n  b\n')).toBe('<ul>\n  <li>a\n    <p>b</p>\n  </li>\n</ul>')
  })

  it('C2-H-018: an image that renders as text is no image run, so the paragraph stays bare', () => {
    expect(render('- ![x][nope]![y][nope]\n')).not.toContain('<p>')
  })

  it('C2-H-186: data-carve-tight stands over a kept <p>, and is still ignored over a text <p>', () => {
    const kept = importDocument('<ul data-carve-tight>\n  <li><p>a</p>\n    <img src="i.png" alt="x">\n  </li>\n  <li>c</li>\n</ul>\n',
      { from: 'html' })
    expect(kept.document.children[0]).toMatchObject({ type: 'list', spacing: 'tight' })
    const commented = importDocument('<ul data-carve-tight><li><p>a</p><!-- c --><img src="i.png" alt="x"></li><li>b</li></ul>',
      { from: 'html' })
    expect(commented.document.children[0]).toMatchObject({ type: 'list', spacing: 'tight' })
    const text = importDocument('<ul data-carve-tight>\n  <li><p>a</p></li>\n  <li>c</li>\n</ul>\n', { from: 'html' })
    expect(text.document.children[0]).toMatchObject({ type: 'list', spacing: 'loose' })
  })

  it('C2-M-092: the shapes read back to the same render, with roundtrip also for a list of several items', () => {
    for (const source of ['- a\n\n  ![x](i.png)\n', '- ![x](i.png)![y](j.png)\n', ':: t\n: ![x](a.png)![y](b.png)\n',
      '- [x] ![x](i.png) ![y](j.png)\n', '> - a\n>\n>   ![x](i.png)\n']) {
      expect(back(source, false), source).toBe(true)
      expect(back(source, true), source).toBe(true)
    }
    for (const source of ['- ![x](i.png)![y](j.png)\n- c\n', '- a\n\n  ![x](i.png)\n- c\n']) {
      expect(back(source, true), source).toBe(true)
      const list = importDocument(render(source, { roundtrip: true }), { from: 'html' }).document.children[0]
      expect(list, source).toMatchObject({ type: 'list', spacing: 'tight' })
    }
  })
})
