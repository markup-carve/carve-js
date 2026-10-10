import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve, renderCarve, renderHtml } from '../src/index.js'

describe('a same-kind span below a braced span of another kind', () => {
  it.each([
    ['all three levels braced', '<p>a<em>b<strong>c<em>d</em></strong></em>e</p>', 'a{/b{*c{/d/}*}/}e\n'],
    ['a braced outer level', '<p>x<em>a <strong>b <em>c</em></strong></em>x</p>', 'x{/a *b {/c/}*/}x\n'],
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
  ])('preserves repeated native emphasis for %s', (_, html) => {
    const tree = htmlToAst(html).value
    expect(carveToHtml(renderCarve(tree))).toBe(renderHtml(tree))
  })

  it.each([
    '<p>a<strong>x<a href="u">y<b>z<br></b></a></strong>b</p>',
    '<p><ins>a<a href="u"><ins>b</ins></a></ins></p>',
  ])('preserves independent link label scopes: %s', (html) => {
    const tree = htmlToAst(html).value
    expect(carveToHtml(renderCarve(tree))).toBe(renderHtml(tree))
  })

})
