import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, renderCarve, renderHtml, SourceUnspellableError, type Document } from '../src/index.js'

const rows: Array<[string, string, string]> = [
  ['a strong ending in a break', '<p>a<strong><b>x<br></b></strong>b</p>', 'a{*{*x\\\n*}*}b\n'],
  ['a strong with text after the inner one', '<p>a<strong><b>x<br></b>y</strong>b</p>', 'a{*{*x\\\n*}y*}b\n'],
  ['an emphasis ending in a break', '<p>a<em><i>x<br></i></em>b</p>', 'a{/{/x\\\n/}/}b\n'],
  ['a superscript', '<p><sup><sup>x</sup></sup></p>', '{^{^x^}^}\n'],
  ['an insertion', '<p><ins><ins>x</ins></ins></p>', '{+x+}\n'],
  ['a deletion', '<p><del><del>x</del></del></p>', '{-x-}\n'],
]

describe('a braced span directly inside a braced span of the same kind', () => {
  it.each(rows)('preserves native nesting and retains editorial refusal for %s', (label, html, carve) => {
    if (label === 'an insertion' || label === 'a deletion') expect(() => renderCarve(htmlToAst(html).value)).toThrow(SourceUnspellableError)
    else expect(renderCarve(htmlToAst(html).value)).toBe(carve)
  })

  it.each(rows)('reports only editorial nesting loss for %s', (label, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(label === 'an insertion' || label === 'a deletion' ? ['structure-unspellable'] : [])
    expect(carveToCarve(result.value)).toBe(result.value)
  })

  it('preserves every level of a triple nesting', () => {
    const result = htmlToCarve('<p><sub><sub><sub>x</sub></sub></sub></p>')
    expect(result.value).toBe('{,{,{,x,},},}\n')
    expect(result.report.diagnostics.map((d) => d.path)).toEqual([])
  })

  it('preserves repeated emphasis inside an ordinary span', () => {
    const result = htmlToCarve('<p><span><sup><sup>x</sup></sup></span></p>')
    expect(result.value).toBe('{^{^x^}^}\n')
    const unspellable = result.report.diagnostics.filter((d) => d.code === 'structure-unspellable')
    expect(unspellable.map((d) => d.path)).toEqual([])
  })

  it('decides from the tree as it is now, not as an earlier render saw it', () => {
    const tree = htmlToAst('<p><strong><b>x<br></b></strong></p>').value
    expect(carveToHtml(renderCarve(tree))).toBe(renderHtml(tree))
    const paragraph = tree.children[0] as { children: Array<{ children: unknown[] }> }
    paragraph.children[0]!.children = [{ type: 'text', value: 'x' }]
    expect(renderCarve(tree)).toBe('*x*\n')
  })

  it('preserves independent attributes on repeated levels', () => {
    const result = htmlToCarve('<p><sup class="a"><sup class="b">x</sup></sup></p>')
    expect(result.value).toBe('{^{^x^}{.b}^}{.a}\n')
    expect(result.report.diagnostics.map((d) => d.code)).toEqual([])
  })
})

describe('a same-kind nesting has no bare spelling either', () => {
  it.each([
    ['a bare inner strong', '<p>a<strong><b>x</b></strong>b</p>', 'a{*{*x*}*}b\n'],
    ['a bare outer strong', '<p><strong><b>x<br></b></strong></p>', '{*{*x\\\n*}*}\n'],
  ])('uses explicit forms for %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics.map((d) => d.code)).toEqual([])
  })

  it('is written and reads back for two kinds, both braced', () => {
    const html = '<p>a<s><del>x</del></s>b</p>'
    const tree: Document = htmlToAst(html).value
    const result = htmlToCarve(html)
    expect(result.value).toBe('a{~{-x-}~}b\n')
    expect(result.report.diagnostics).toEqual([])
    expect(carveToHtml(result.value)).toBe(renderHtml(tree))
  })
})
