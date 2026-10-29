import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// An unclosed run takes the rest of the block, a braced closer included, so the
// pair has no closer and its opener is text (markup-carve/carve#3973 X5). The
// writer closes the run it reads.
describe('an unclosed run inside a braced pair', () => {
  it.each([
    ['{~` ~}\n', '{~` ~}`\n'],
    ['a {~` ~} b\n', 'a {~` ~} b`\n'],
    ['{*`  *}\n', '{*`  *}`\n'],
    ['{~`~}\n', '{~`~}`\n'],
    ['{/` /}\n', '{/` /}`\n'],
    ['{_` _}\n', '{_` _}`\n'],
    ['{=` =}\n', '{=` =}`\n'],
    ['{~`a ~}\n', '{~`a ~}`\n'],
  ])('writes %j as text and a closed run', (src, want) => {
    const out = carveToCarve(src)
    expect(out).toBe(want)
    expect(carveToHtml(out)).toBe(carveToHtml(src))
    expect(carveToCarve(out)).toBe(out)
  })

  it('leaves an emphasis that holds no code span bare', () => {
    expect(carveToCarve('{~a~}\n')).toBe('~a~\n')
    expect(carveToCarve('{*a*}\n')).toBe('*a*\n')
  })
})
