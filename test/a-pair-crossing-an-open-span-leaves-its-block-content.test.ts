import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 E2: a closer demotes the openers above it, so a pair whose opener sits
// in a span closing first does not form, and its block is text (corpus 776).
// Expected HTML is the spec model's.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a pair crossing an open span does not hide its block (carve-js#3941)', () => {
  it.each([
    ['_/*a//*{t=_} b_', '<p><u><em>*a</em>/*{t=</u>} b_</p>'],
    ['_/=//={t=_} b_', '<p><u><em>=</em>/<mark>{t</mark></u>} b_</p>'],
    ['a b _/*a//*{t="__"} b_', '<p>a b <u><em>*a</em>/*{t=“</u>_”} b_</p>'],
    ["~*x _a b*_{t='~'} z~", '<p><s><strong>x _a b</strong>_{t=‘</s>’} z~</p>'],
    ['=_/a_ y/{t="="}= b', '<p><mark><u>/a</u> y/{t</mark>”<mark>“}</mark> b</p>'],
    ['{/=~a b=~{t=/} b/}', '<p><em><mark>~a b</mark>~{t=</em> b/}</p>'],
    ['{_~x *b c~~*{t=_} b_} a_ b', '<p><u><s>x *b c</s>~*{t=</u> b_} a_ b</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  // The italic is guarded by the underline, which closes nowhere else, so
  // pairing blocks it and the strike takes the block.
  it('keeps the block where the crossing opener is blocked', () => {
    expect(html('_/~/b/~{t=_} b=')).toBe('<p>_/<s t="_"><em>b</em></s> b=</p>')
  })
})
