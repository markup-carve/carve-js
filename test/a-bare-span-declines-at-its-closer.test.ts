import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// R2 declines at the closer, so until then the entry is on the stack (carve#4810).
describe('a bare entry that declines at its closer (carve-js#4199)', () => {
  it.each([
    ['*x /*y*b*/\n', '<p>*x <em>*y*b*</em></p>'],
    ['*x*z /*y*/\n', '<p>*x*z <em>*y*</em></p>'],
    ['/x/z /*y*/\n', '<p>/x/z /<strong>y</strong>/</p>'],
    ['*x*z *y*\n', '<p>*x*z *y*</p>'],
    ['*a*b* *c*\n', '<p>*a*b* <strong>c</strong></p>'],
    ['/a/b *c/ d*\n', '<p>/a/b <strong>c/ d</strong></p>'],
    ['*x*y /*a*/ z*\n\n*a*\n', '<p>*x*y <em>*a*</em> z*</p>\n<p><strong>a</strong></p>'],
    ['/*y*b*/\n', '<p><strong><em>y*b</em></strong></p>'],
  ])('reads %j', (src, want) => {
    expect(carveToHtml(src)).toBe(want)
  })
})
