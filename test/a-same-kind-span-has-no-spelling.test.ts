import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, renderCarve, renderHtml, SourceUnspellableError } from '../src/index.js'

// PART 9 §9 E3 pushes no second level of one kind while one is open, and the
// forced `{X X}` form is on the same stack (markup-carve/carve#2078), so a span
// of a kind already open has no spelling at all. The writer refuses the tree
// and the HTML importer unwraps the inner level with a report (carve-js#1831,
// the direction markup-carve/carve#2066 set).

const nested: Array<[string, string, string]> = [
  ['an emphasis padded by spaces', '<p><em>a <em>b</em> c</em></p>', '/a b c/\n'],
  ['a strong padded by spaces', '<p><strong>a <b>b</b> c</strong></p>', '*a b c*\n'],
  ['an underline', '<p><u>a <u>b</u> c</u></p>', '_a b c_\n'],
  ['a strike', '<p><s>a <s>b</s> c</s></p>', '~a b c~\n'],
  ['a highlight', '<p><mark>a <mark>b</mark> c</mark></p>', '=a b c=\n'],
  ['a strong alone', '<p><strong><b>x</b></strong></p>', '*x*\n'],
  ['an emphasis through a strong', '<p><em>a <strong>b <em>c</em></strong></em></p>', '/a *b c*/\n'],
  ['an emphasis through a link', '<p><em>a <a href="u">b <em>c</em></a></em></p>', '/a [b c](u)/\n'],
  ['a bare inner span in a braced one', '<p>a<strong><b>x</b></strong>b</p>', 'a{*x*}b\n'],
]

describe('a span inside a span of the same kind', () => {
  it.each(nested)('is refused by the writer for %s', (_, html) => {
    expect(() => renderCarve(htmlToAst(html).value)).toThrow(SourceUnspellableError)
  })

  it.each(nested)('is unwrapped and reported by the importer for %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['structure-unspellable'])
    expect(carveToCarve(result.value)).toBe(result.value)
  })

  it.each([
    ['two kinds', '<p><em>a <strong>b</strong> c</em></p>', '/a *b* c/\n'],
    ['two kinds, both braced', '<p>a<s><del>x</del></s>b</p>', 'a{~{-x-}~}b\n'],
  ])('keeps %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics).toEqual([])
    expect(carveToHtml(result.value)).toBe(renderHtml(htmlToAst(html).value))
  })
})
