import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// markup-carve/carve-js#4206: an atom is one token to the bare delimiter scan.
describe('a bare span scans its own text for word delimiters', () => {
  it.each([
    '/see [x](http://a.b/c) now/\n',
    '/see <http://a.b/c> now/\n',
    '/see [x/y](/u) now/\n',
    '/see `a/b` now/\n',
    '/see ![a/b](/u/v) now/\n',
    '/a $`x/y` b/\n',
    '_see [x](/a_b) c_\n',
    '*see [x](/a*b) c*\n',
    '=see [x](/a=b) c=\n',
    '~see [x](/a~b) c~\n',
    '/a {% x/y %} b/\n',
  ])('keeps %j bare', (source) => {
    expect(carveToCarve(source)).toBe(source)
  })

  it.each([
    ['{/a/b/}\n'],
    ['{/a {*x/y*} b/}\n', '{/a *x/y* b/}\n'],
    ['{/see {% xy %}/}\n'],
    ['{/{% xy %} see/}\n'],
    ['{/{% xy %}/}\n'],
  ])('keeps the braces %j needs', (source, written = source) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })
})
