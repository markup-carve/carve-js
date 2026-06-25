import { describe, expect, it } from 'vitest'

import { carveToHtml, colorSwatch } from '../src/index.js'
import type { SwatchPosition, SwatchShape } from '../src/color-swatch.js'

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

  it('a bareword that is not a CSS named color defers to the fallback', () => {
    expect(carveToHtml(':color[banana]', { extensions: [colorSwatch()] })).toBe(
      '<p><span class="ext-color">banana</span></p>',
    )
  })

  it('matches a CSS named color case-insensitively', () => {
    expect(carveToHtml(':color[DarkSlateGray]', { extensions: [colorSwatch()] })).toBe(
      '<p><span class="swatch"><span class="swatch-chip" style="background-color:DarkSlateGray"></span> DarkSlateGray</span></p>',
    )
  })

  it('position: after renders the chip after the value', () => {
    expect(carveToHtml(':color[#3b82f6]', { extensions: [colorSwatch({ position: 'after' })] })).toBe(
      '<p><span class="swatch">#3b82f6 <span class="swatch-chip" style="background-color:#3b82f6"></span></span></p>',
    )
  })

  it('position: none renders the chip only with the value as title', () => {
    expect(carveToHtml(':color[#3b82f6]', { extensions: [colorSwatch({ position: 'none' })] })).toBe(
      '<p><span class="swatch swatch-chip-only" title="#3b82f6"><span class="swatch-chip" style="background-color:#3b82f6"></span></span></p>',
    )
  })

  it('shape: round adds the modifier class', () => {
    expect(carveToHtml(':color[#3b82f6]', { extensions: [colorSwatch({ shape: 'round' })] })).toContain(
      '<span class="swatch-chip swatch-chip-round" style="background-color:#3b82f6">',
    )
  })

  it('shape: ring uses the color as the chip border', () => {
    const html = carveToHtml(':color[#3b82f6]', { extensions: [colorSwatch({ shape: 'ring' })] })
    expect(html).toContain('swatch-chip-ring')
    expect(html).toContain('style="border-color:#3b82f6"')
    expect(html).not.toContain('background-color:#3b82f6')
  })

  it('tint paints a color-mix tint behind the swatch', () => {
    const html = carveToHtml(':color[#3b82f6]', { extensions: [colorSwatch({ tint: true })] })
    expect(html).toContain('class="swatch swatch-tint"')
    expect(html).toContain('style="background-color:color-mix(in srgb, #3b82f6 12%, transparent)"')
  })

  it('throws on an invalid option', () => {
    expect(() => colorSwatch({ position: 'sideways' as SwatchPosition })).toThrow()
    expect(() => colorSwatch({ shape: 'triangle' as SwatchShape })).toThrow()
  })
})
