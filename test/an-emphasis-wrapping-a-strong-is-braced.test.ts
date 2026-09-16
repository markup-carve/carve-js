import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// markup-carve/carve-js#1758: `/*` opens `bold_italic` and `*/` closes it, so a
// bare emphasis whose content has both reads back as the other nesting.
describe('an emphasis wrapping a strong is braced', () => {
  it.each([
    ['{/*x*/}', '{/*x*/}\n'],
    ['/{*x*}/', '{/*x*/}\n'],
    ['{/{*x*}/}', '{/*x*/}\n'],
    ['{/*x* y *z*/}', '{/*x* y *z*/}\n'],
    ['{/{*x*} y {*z*}/}', '{/*x* y *z*/}\n'],
    ['a {/*x*/} b', 'a {/*x*/} b\n'],
    ['{/*x*/}{*y*}', '{/*x*/}*y*\n'],
  ])('%s', (source, formatted) => {
    expect(carveToCarve(source)).toBe(formatted)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  })

  it.each([
    ['/*x*/', '/*x*/\n'],
    ['{*/x/*}', '*/x/*\n'],
    ['{/*x* y/}', '/*x* y/\n'],
    ['{/y *x*/}', '/y *x*/\n'],
    ['{_*x*_}', '_*x*_\n'],
    ['{~*x*~}', '~*x*~\n'],
  ])('keeps %s bare where no combined token forms', (source, formatted) => {
    expect(carveToCarve(source)).toBe(formatted)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  })
})
