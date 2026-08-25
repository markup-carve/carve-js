import { describe, expect, test } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

/**
 * markup-carve/carve#1755: `{align=left|right|center}` on an element whose
 * `align` means TEXT ALIGNMENT renders the CSS declaration instead of the
 * deprecated presentational attribute.
 */
describe('an aligned text block renders a style declaration', () => {
  test.each([
    ['a paragraph', '{align=right}\npara\n', '<p style="text-align: right;">para</p>'],
    ['a heading', '{align=left}\n# H\n', '<h1 style="text-align: left;">H</h1>'],
    ['a div', '{align=center}\n::: box\nx\n:::\n', '<div class="box" style="text-align: center;">'],
  ])('%s', (_name, source, expected) => {
    expect(carveToHtml(source)).toContain(expected)
  })

  test.each([
    ['left', '<p style="text-align: left;">para</p>'],
    ['right', '<p style="text-align: right;">para</p>'],
    ['center', '<p style="text-align: center;">para</p>'],
  ])('the %s value', (value, expected) => {
    expect(carveToHtml(`{align=${value}}\npara\n`)).toContain(expected)
  })

  test('the deprecated attribute is gone where the declaration belongs', () => {
    expect(carveToHtml('{align=right}\npara\n')).not.toContain('align="right"')
  })

  test('an author style keeps one attribute, with the declaration appended', () => {
    expect(carveToHtml('{align=right style="color: red"}\npara\n')).toContain(
      '<p style="color: red; text-align: right;">para</p>',
    )
  })

  /**
   * ON A TABLE `align` IS PLACEMENT, NOT TEXT ALIGNMENT - the table floats left
   * or right, or centres as a block. Rewriting it to `text-align` would
   * silently right-align the CELL TEXT of every floated table instead of
   * floating it, so the table is scoped out of the ruling and keeps the legacy
   * attribute. Do not "tidy" this into the set above.
   */
  test('a table keeps the placement attribute', () => {
    expect(carveToHtml('{align=right}\n| a |\n')).toContain('<table align="right">')
  })

  /**
   * The same reason: HTML maps `align` on an image to a float, never to
   * `text-align`.
   */
  test('an image keeps the placement attribute', () => {
    expect(carveToHtml('{align=right}\n![alt](x.png)\n')).toContain('align="right"')
  })

  test('the raw pass-through is untouched for every other key', () => {
    expect(carveToHtml('{banana=yellow}\npara\n')).toContain('<p banana="yellow">para</p>')
  })

  /** markup-carve/carve#1756 ruled `{valign=…}` working as designed. */
  test('valign off a cell is unchanged', () => {
    expect(carveToHtml('{valign=top}\npara\n')).toContain('<p valign="top">para</p>')
  })

  /** Only the three values HTML gives a `text-align` meaning are rewritten. */
  test('a value outside the ruled set passes through raw', () => {
    expect(carveToHtml('{align=justify}\npara\n')).toContain('<p align="justify">para</p>')
  })

  test('a cell alignment marker still renders its own declaration', () => {
    expect(carveToHtml('|> a | b |\n')).toContain('<td style="text-align: right;">a</td>')
  })

  test('html -> carve -> html is a fixed point for an aligned paragraph', () => {
    const source = '<p style="text-align: right;">x</p>'
    const once = carveToHtml(htmlToCarve(source, { mode: 'roundtrip' }).value)
    expect(once).toContain('<p style="text-align: right;">x</p>')
    const twice = carveToHtml(htmlToCarve(once, { mode: 'roundtrip' }).value)
    expect(twice).toBe(once)
  })
})
