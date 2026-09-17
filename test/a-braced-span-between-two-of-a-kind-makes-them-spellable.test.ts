import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve, renderCarve, renderHtml, SourceUnspellableError } from '../src/index.js'

// A braced span of another kind starts its own E3 scope (markup-carve/carve#2091),
// so a same-kind span below it is spellable and not unwrapped. With nothing
// braced between the two levels the refusal stands (carve-js#1849).

describe('a same-kind span below a braced span of another kind', () => {
  it.each([
    ['all three levels braced', '<p>a<em>b<strong>c<em>d</em></strong></em>e</p>', 'a{/b{*c{/d/}*}/}e\n'],
    ['a braced outer level', '<p>x<em>a <strong>b <em>c</em></strong></em>x</p>', 'x{/a {*b /c/*}/}x\n'],
    ['an insertion in a deletion in an insertion', '<p><ins>a<del>x<ins>b</ins></del></ins></p>', '{+a{-x{+b+}-}+}\n'],
  ])('is written for %s', (_, html, carve) => {
    const tree = htmlToAst(html).value
    expect(renderCarve(tree)).toBe(carve)
    const imported = htmlToCarve(html)
    expect(imported.value).toBe(carve)
    expect(imported.report.diagnostics).toEqual([])
    expect(carveToHtml(carve)).toBe(renderHtml(tree))
  })

  it.each([
    ['a strong directly in a strong', '<p>a<strong><b>x<br></b></strong>b</p>'],
    ['a superscript directly in a superscript', '<p><sup><sup>x</sup></sup></p>'],
    ['a strong in a strong through a link, which is no braced span', '<p>a<strong>x<a href="u">y<b>z<br></b></a></strong>b</p>'],
    ['an insertion in an insertion through a link', '<p><ins>a<a href="u"><ins>b</ins></a></ins></p>'],
  ])('is still refused for %s', (_, html) => {
    expect(() => renderCarve(htmlToAst(html).value)).toThrow(SourceUnspellableError)
  })
})
