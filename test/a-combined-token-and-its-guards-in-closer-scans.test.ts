import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 4 and PART 9 E2/E2a/E3: a combined token is one construct, and a block
// attaches only to a pair that forms. Expected HTML is the spec model's.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a combined token is opaque to the closer walk (carve-js#3910)', () => {
  it.each([
    ['_x /*a*/{.q} b/{c_} c_', '<p><u>x <strong class="q"><em>a</em></strong> b/{c</u>} c_</p>'],
    ['_x /*a*/.q} b/{c_} c_', '<p><u>x <strong><em>a</em></strong>.q} b/{c</u>} c_</p>'],
    ['_x /*a_*/{.q} b/{c_} c_', '<p><u>x <strong class="q"><em>a_</em></strong> b/{c</u>} c_</p>'],
    ['_x~/*a*/{.q} b/{c_} c_', '<p><u>x~<strong class="q"><em>a</em></strong> b/{c</u>} c_</p>'],
    ['_x */*a*/{.q} b/{c_} c_', '<p><u>x <strong>/*a</strong><em c_="">{.q} b</em> c</u></p>'],
    ['{*_x /*a*/=/{.q} b/{c_} c_*}', '<p><strong><u>x <strong><em>a</em></strong>=<em c_="">{.q} b</em> c</u></strong></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

describe('a bare pair forms only if every guard before it does (carve-js#3913)', () => {
  it.each([
    ['{/x /_=a={t="/}"} a_ b/}', '<p><em>x /_=a={t=“</em>”} a_ b/}</p>'],
    ['{*x /_=a={t="*}"} a_ b*}', '<p><strong>x /_=a={t=“</strong>”} a_ b*}</p>'],
    ['{/x {/_=a={t="/}"} a_ b/}', '<p>{/x <em><u><mark t="/}">a</mark> a</u> b</em></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})
