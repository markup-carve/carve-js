import { describe, expect, it } from 'vitest'

import { carveToHtml, colorSwatch } from '../src/index.js'

describe('color swatch extension', () => {
  it('inline :color[...] renders a swatch for hex colors', () => {
    expect(carveToHtml(':color[#ff8800]', { extensions: [colorSwatch()] })).toBe(
      '<p><span class="swatch"><span class="swatch-chip" style="background-color:#ff8800"></span> #ff8800</span></p>',
    )
  })

  it('inline :color[...] renders a swatch for named colors', () => {
    expect(carveToHtml(':color[rebeccapurple]', { extensions: [colorSwatch()] })).toBe(
      '<p><span class="swatch"><span class="swatch-chip" style="background-color:rebeccapurple"></span> rebeccapurple</span></p>',
    )
  })

  it('inline :color[...] renders a swatch for rgb functions', () => {
    expect(carveToHtml(':color[rgb(248,81,73)]', { extensions: [colorSwatch()] })).toBe(
      '<p><span class="swatch"><span class="swatch-chip" style="background-color:rgb(248,81,73)"></span> rgb(248,81,73)</span></p>',
    )
  })

  it('inline merges author classes onto the outer span and strips event handlers', () => {
    expect(carveToHtml(':color[#fff]{#x .y onclick="z"}', { extensions: [colorSwatch()] })).toBe(
      '<p><span id="x" class="swatch y"><span class="swatch-chip" style="background-color:#fff"></span> #fff</span></p>',
    )
  })

  it('inline falls back to ext-color span without the extension', () => {
    expect(carveToHtml(':color[rebeccapurple]')).toBe(
      '<p><span class="ext-color">rebeccapurple</span></p>',
    )
  })

  it('invalid colors defer to the generic ext-color fallback', () => {
    expect(carveToHtml(':color[nope!]', { extensions: [colorSwatch()] })).toBe(
      '<p><span class="ext-color">nope!</span></p>',
    )
    expect(carveToHtml(':color[red;}x{}]', { extensions: [colorSwatch()] })).toBe(
      '<p><span class="ext-color">red;}x{}</span></p>',
    )
  })
})
