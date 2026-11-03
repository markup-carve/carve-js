import { describe, expect, it } from 'vitest'
import {
  carveToAstJson, carveToCarve, carveToHtml, fromAstJson, renderHtml, renderMarkdownWithReport,
} from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

const strip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, v: unknown) => (key === 'pos' || key === 'order' ? undefined : v)))

const throughAst = (source: string) => fromAstJson(carveToAstJson(source))

// Ruling A on markup-carve/carve#5039 (PART 12 §23, CARVE-P12-043).
describe('a block image attribute line stays on the paragraph', () => {
  it('splits a reference image from its definition attributes', () => {
    const source = '{.c}\n![a][ex]\n\n[ex]: /i.png {.wide}\n'
    expect(strip(carveToAstJson(source).children[0])).toEqual({
      type: 'paragraph', blockImage: true, attrs: { classes: ['c'] },
      children: [{ type: 'image', src: '/i.png', alt: 'a', ref: 'ex', rawRef: '![a][ex]', attrs: { classes: ['wide'] } }],
    })
    expect(carveToHtml(source)).toBe('<img src="/i.png" alt="a" class="c wide">')
    expect(renderHtml(throughAst(source))).toBe(carveToHtml(source))
    expect(renderCarve(throughAst(source))).toBe(source)
  })

  it('publishes an image without attributes of its own bare', () => {
    const source = '{#i}\n![a](/i.png)\n'
    expect(strip(carveToAstJson(source).children[0])).toEqual({
      type: 'paragraph', blockImage: true, attrs: { id: 'i' },
      children: [{ type: 'image', src: '/i.png', alt: 'a' }],
    })
    expect(renderHtml(throughAst(source))).toBe(carveToHtml(source))
  })

  it('writes the attribute line back in fmt (corpus 754)', () => {
    const source = '{.outer k=one}\n![a](b){.inner k=two}\n'
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('reports the block run as dropped from the tree as from the source', () => {
    const source = '{.outer k=one}\n![a](b){.inner k=two}\n'
    const codes = (report: { losses: Array<{ code: string }> }) => report.losses.map(loss => loss.code)
    expect(codes(renderMarkdownWithReport(throughAst(source)))).toEqual(['markdown-attributes-dropped'])
  })

  it('puts the attribute line on the figure a caption builds', () => {
    const source = '{.c}\n![a][ex]\n^ cap\n\n[ex]: /i.png {.wide}\n'
    expect(carveToHtml(source)).toContain('<figure class="c">')
    expect(renderHtml(throughAst(source))).toBe(carveToHtml(source))
  })
})

// Ruling A on markup-carve/carve#5038: the target is the paragraph when it holds more than the image.
describe('a figure over an image beside a comment', () => {
  const figureHtml = '<figure>\n  <img src="/i" alt="a">\n  <figcaption>cap</figcaption>\n</figure>'

  for (const line of ['{%%}![a](/i)', '![a](/i){%%}', '![a](/i) %% c']) {
    it(`keeps the comment in a paragraph target: ${line}`, () => {
      const source = `${line}\n^ cap\n`
      const figure = carveToAstJson(source).children[0] as { type: string; target: { type: string; blockImage?: boolean; children?: Array<{ type: string }> } }
      expect(figure.type).toBe('figure')
      expect(figure.target.type).toBe('paragraph')
      expect(figure.target.blockImage).toBe(true)
      expect(figure.target.children!.map(child => child.type).sort()).toEqual(['comment', 'image'])
      expect(carveToHtml(source)).toBe(figureHtml)
      expect(renderHtml(throughAst(source))).toBe(figureHtml)
      expect(renderCarve(throughAst(source))).toBe(carveToCarve(source))
    })
  }

  it('keeps an image target when nothing sits beside it', () => {
    const figure = carveToAstJson('![a](/i)\n^ cap\n').children[0] as { target: { type: string } }
    expect(figure.target.type).toBe('image')
  })
})
