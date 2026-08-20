import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/*
 * markup-carve/carve#1450. An identifier may start with `_`, so `{_x_}` was two
 * constructs at once: the boolean attribute `_x_`, and a forced underline.
 * Alone on a line the attribute reading won, the underline was unreachable, and
 * with no block beneath it to attach to the line rendered NOTHING - five
 * characters kept in the source and gone from the output.
 *
 * The BARE form gives the collision up. HTML has no underscore-first boolean
 * attribute to lose, and every other attribute form keeps its leading
 * underscore, because none of them ends `_}`.
 */
describe('a boolean attribute does not start with an underscore', () => {
  it('reads a lone braced pair as an underline', () => {
    expect(h('{_x_}')).toBe('<p><u>x</u></p>')
    expect(h('{_x_}\npara')).toBe('<p><u>x</u>\npara</p>')
  })

  it('reads it as an underline mid-line too, as it always did', () => {
    expect(h('{_x_} y')).toBe('<p><u>x</u> y</p>')
    expect(h('y {_x_}')).toBe('<p>y <u>x</u></p>')
  })

  it('leaves a bare underscore-first word as text', () => {
    // It has no underline reading either - it does not end `_}` - so it renders
    // literally rather than becoming something else.
    expect(h('{_foo}\npara')).toBe('<p>{_foo}\npara</p>')
    expect(h('[x]{_u}')).toBe('<p>[x]{_u}</p>')
  })

  it('keeps the underscore in every other attribute form', () => {
    expect(h('{#_id ._c _k=1 _="on click"}\npara')).toBe(
      '<p id="_id" class="_c" _k="1" _="on click">para</p>',
    )
    expect(h('[x]{#_u}')).toBe('<p><span id="_u">x</span></p>')
    expect(h('[x]{._u}')).toBe('<p><span class="_u">x</span></p>')
    expect(h('[x]{_u=1}')).toBe('<p><span _u="1">x</span></p>')
  })

  it('still reads an ordinary boolean attribute', () => {
    expect(h('{disabled}\npara')).toBe('<p disabled="">para</p>')
    expect(h('[x]{kbd}')).toBe('<p><kbd>x</kbd></p>')
  })

  it('does not shorten a value-less underscore name when writing', () => {
    // PART 11 §6c shortens a value-less attribute to its bare name, and cannot
    // here: `{_u}` is text and `{_x_}` is an underline, either way a document
    // the writer changed. §1 forbids that, so the `=""` stays.
    expect(carveToCarve('[x]{_u=""}\n').trim()).toBe('[x]{_u=""}')
    expect(carveToHtml(carveToCarve('[x]{_u=""}\n'))).toBe(carveToHtml('[x]{_u=""}\n'))
    // The ordinary name still shortens.
    expect(carveToCarve('[x]{kbd=""}\n').trim()).toBe('[x]{kbd}')
  })
})
