import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

// djot.js charges a blank read while an item's sub-list is open to the sub-list,
// so the item stays tight; the importer drops the blank (carve#5197).
describe('a Djot blank after a sub-list', () => {
  it.each([
    ['- one\n\n  - two\n\n  > q\n', '- one\n  - two\n  > q\n'],
    ['- one\n\n  - two\n\n  # H\n', '- one\n  - two\n  # H\n'],
    ['- one\n\n  - two\n\n  ```\n  code\n  ```\n', '- one\n  - two\n  ```\n  code\n  ```\n'],
    ['- one\n\n  - two\n\n  1. x\n', '- one\n  - two\n  1. x\n'],
    ['- one\n\n  1. two\n\n  {.c}\n  para\n', '- one\n  1. two\n  {.c}\n  para\n'],
    ['> - one\n>\n>   - two\n>\n>   > q\n', '> - one\n>   - two\n>   > q\n'],
  ])('is dropped in %j', (djot, carve) => {
    expect(djotToCarve(djot)).toBe(carve)
  })

  it.each([
    ['- one\n\n  - two\n\n  para\n', '- one\n  - two\n+\npara\n'],
    ['- one\n\n  - two\n\n  para\n  more\n', '- one\n  - two\n+\npara\n  more\n'],
    ['- top\n\n  - one\n\n    - two\n\n    para\n', '- top\n  - one\n    - two\n  +\n  para\n'],
  ])('moves a paragraph behind a `+` in %j', (djot, carve) => {
    expect(djotToCarve(djot)).toBe(carve)
    expect(carveToHtml(carve)).not.toContain('<p>')
  })

  it('imports the item tight', () => {
    expect(carveToHtml(djotToCarve('- one\n\n  - two\n\n  > q\n'))).toBe(
      '<ul>\n  <li>one\n    <ul>\n      <li>two</li>\n    </ul>\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>')
  })

  it.each([
    '- one\n\n  - two\n\n  > q\n\n  para\n',
    '- one\n\n  > a\n\n  - two\n\n  > q\n',
    '- one\n\n  - two\n\n  ::: d\n  x\n  :::\n- next\n',
    '- one\n\n  1. two\n\n  {.c}\n  para\n\n- next\n',
    '- one\n\n  - two\n\n  [x]: /url\n\n- next\n',
  ])('stays where djot.js loosens the list: %j', (djot) => {
    expect(carveToHtml(djotToCarve(djot))).toContain('<p>one</p>')
  })
})
