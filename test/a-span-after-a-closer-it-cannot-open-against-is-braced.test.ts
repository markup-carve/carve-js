import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// markup-carve/carve-js#1743: `bare_opener` (CARVE-P3-013) refuses a marker after
// `_`, after the same marker, and after `/` for `/` and `_`, so the second span
// takes braces.
describe('a span after a closer it cannot open against is braced', () => {
  it.each([
    ['{/x/}{/y/}', '/x/{/y/}\n'],
    ['{*x*}{*y*}', '*x*{*y*}\n'],
    ['{_x_}{_y_}', '_x_{_y_}\n'],
    ['{~x~}{~y~}', '~x~{~y~}\n'],
    ['{=x=}{=y=}', '=x={=y=}\n'],
    ['{_x_}{*y*}', '_x_{*y*}\n'],
    ['{/x/}{_y_}', '/x/{_y_}\n'],
    ['{/x/}{/y/}{/z/}', '/x/{/y/}/z/\n'],
    ['~{/x/}{/y~/}', '~/x/{/y~/}\n'],
  ])('%s', (source, formatted) => {
    expect(carveToCarve(source)).toBe(formatted)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  })

  it.each([
    ['{*x*}{/y/}', '*x*/y/\n'],
    ['{/x/}{*y*}', '/x/*y*\n'],
  ])('keeps %s bare where the opener may follow the closer', (source, formatted) => {
    expect(carveToCarve(source)).toBe(formatted)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  })
})
