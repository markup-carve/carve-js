import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, renderCarve, renderHtml } from '../src/index.js'

const nested: Array<[string, string, string]> = [
  ['an emphasis padded by spaces', '<p><em>a <em>b</em> c</em></p>', '{/a {/b/} c/}\n'],
  ['a strong padded by spaces', '<p><strong>a <b>b</b> c</strong></p>', '{*a {*b*} c*}\n'],
  ['an underline', '<p><u>a <u>b</u> c</u></p>', '{_a {_b_} c_}\n'],
  ['a strike', '<p><s>a <s>b</s> c</s></p>', '{~a {~b~} c~}\n'],
  ['a highlight', '<p><mark>a <mark>b</mark> c</mark></p>', '{=a {=b=} c=}\n'],
  ['a strong alone', '<p><strong><b>x</b></strong></p>', '{*{*x*}*}\n'],
  ['a bare inner span in a braced one', '<p>a<strong><b>x</b></strong>b</p>', 'a{*{*x*}*}b\n'],
]

describe('a span inside a span of the same kind', () => {
  it.each(nested)('is preserved by the writer for %s', (_, html, carve) => {
    expect(renderCarve(htmlToAst(html).value)).toBe(carve)
  })

  it.each(nested)('is preserved without a loss diagnostic for %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics.map((d) => d.code)).toEqual([])
    expect(carveToCarve(result.value)).toBe(result.value)
  })

  it.each([
    ['an emphasis through a link', '<p><em>a <a href="u">b <em>c</em></a></em></p>', '{/a [b {/c/}](u)/}\n'],
    ['two kinds', '<p><em>a <strong>b</strong> c</em></p>', '/a *b* c/\n'],
    ['two kinds, both braced', '<p>a<s><del>x</del></s>b</p>', 'a{~{-x-}~}b\n'],
    ['an emphasis through a strong, which braces the strong', '<p><em>a <strong>b <em>c</em></strong></em></p>', '{/a *b {/c/}*/}\n'],
  ])('keeps %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics).toEqual([])
    expect(carveToHtml(result.value)).toBe(renderHtml(htmlToAst(html).value))
  })
})
