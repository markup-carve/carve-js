import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P9-043 R2: the closer that declines a bare entry is text, even where it
// could also open a span; past it the kind opens again. Expected HTML is the
// spec model's (carve-js#4199).
const html = (src: string) => carveToHtml(src).replace(/\n\s*/g, '').trim()

describe('the closer that declines a bare entry is text', () => {
  it.each([
    ['*x a*b *c.*(e)* /k/', '<p>*x a*b *c.*(e)* <em>k</em></p>'],
    ['(/x a/b /c./(e)/', '<p>(/x a/b /c./(e)/</p>'],
    ['_x y a_b _c._(e)__', '<p>_x y a_b _c._(e)__</p>'],
    ['- .*xb*x/*}*/x~', '<ul><li>.*xb*x/*}*/x~</li></ul>'],
    ['*x a*b z* *c*', '<p>*x a*b z* <strong>c</strong></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})
