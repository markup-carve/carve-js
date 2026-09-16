import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, renderCarve, renderHtml, SourceUnspellableError } from '../src/index.js'

// PART 9 §9 E3 pushes no second level of one kind while one is open, so a bare
// span inside a bare span of its kind closes the outer one. The inner span is
// braced; one inside a braced span of its kind has no spelling (carve-js#1817).

describe('a span inside a bare span of the same kind', () => {
  it.each([
    ['an emphasis padded by spaces', '<p><em>a <em>b</em> c</em></p>', '/a {/b/} c/\n'],
    ['a strong padded by spaces', '<p><strong>a <b>b</b> c</strong></p>', '*a {*b*} c*\n'],
    ['an underline', '<p><u>a <u>b</u> c</u></p>', '_a {_b_} c_\n'],
    ['a strike', '<p><s>a <s>b</s> c</s></p>', '~a {~b~} c~\n'],
    ['a highlight', '<p><mark>a <mark>b</mark> c</mark></p>', '=a {=b=} c=\n'],
    ['a strong alone', '<p><strong><b>x</b></strong></p>', '*{*x*}*\n'],
    ['an emphasis through a strong', '<p><em>a <strong>b <em>c</em></strong></em></p>', '/a *b {/c/}*/\n'],
    ['an emphasis through a link', '<p><em>a <a href="u">b <em>c</em></a></em></p>', '/a [b {/c/}](u)/\n'],
  ])('is braced for %s', (_, html, carve) => {
    const written = htmlToCarve(html).value
    expect(written).toBe(carve)
    expect(carveToHtml(written)).toBe(renderHtml(htmlToAst(html).value))
    expect(carveToCarve(written)).toBe(written)
  })

  it.each([
    ['a bare inner span in a braced one', '<p>a<strong><b>x</b></strong>b</p>', 'a{**x**}b\n'],
    ['a bare emphasis through a strong in a braced one', '<p>x<em>a <strong>b <em>c</em></strong></em>x</p>', 'x{/a *b /c/*/}x\n'],
    ['two kinds', '<p><em>a <strong>b</strong> c</em></p>', '/a *b* c/\n'],
  ])('keeps the bare form for %s', (_, html, carve) => {
    const written = htmlToCarve(html).value
    expect(written).toBe(carve)
    expect(carveToHtml(written)).toBe(renderHtml(htmlToAst(html).value))
  })

  it('refuses a braced span inside a braced span of its kind through another span', () => {
    const tree = htmlToAst('<p>x<em>a <strong>b <em>c</em></strong></em>x</p>').value
    const paragraph = tree.children[0] as unknown as { children: Array<{ children: Array<{ children: Array<{ children: unknown[] }> }> }> }
    const inner = paragraph.children[1]!.children[1]!.children[1]!
    inner.children.push({ type: 'hard_break' })
    expect(() => renderCarve(tree)).toThrow(SourceUnspellableError)
  })
})
