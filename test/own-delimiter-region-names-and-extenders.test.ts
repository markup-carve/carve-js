import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

// A mention or tag name is not the region R2 looks for its own delimiter in,
// and a word character keeps its grapheme extenders (carve#4810).
describe('the own-delimiter decline region (carve-js#4246)', () => {
  it.each([
    ['_@a_b_\n', '<p><u><span class="mention"><strong>@a_b</strong></span></u></p>'],
    ['_#a_b_ x\n', '<p><u><span class="tag"><strong>#a_b</strong></span></u> x</p>'],
    ['_q @a_b_c_\n', '<p><u>q <span class="mention"><strong>@a_b_c</strong></span></u></p>'],
    ['_@a__b_\n', '<p><u><span class="mention"><strong>@a</strong></span></u>_b_</p>'],
    ['_a@b_c_\n', '<p>_a@b_c_</p>'],
    ['_@a_b x_y_\n', '<p>_@a_b x_y_</p>'],
    ['/é/b/\n', '<p>/é/b/</p>'],
    ['*á́*b*\n', '<p>*á́*b*</p>'],
    ['/é\\/b/\n', '<p><em>é/b</em></p>'],
    ['/é/\n', '<p><em>é</em></p>'],
  ])('reads %j', (src, want) => {
    expect(carveToHtml(src)).toBe(want)
  })

  it('braces an emphasis whose content holds its delimiter after a combining mark', () => {
    const src = '{/é/b/}\n'
    const written = renderCarve(parse(src))
    expect(carveToHtml(written)).toBe('<p><em>é/b</em></p>')
  })
})
