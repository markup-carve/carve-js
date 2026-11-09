import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an attribute left of a skipped note body with the first-block host (carve#5576)', () => {
  const expected = '<ul>\n  <li><p class="x y">p</p></li>\n</ul>'
  for (const attribute of ['{.x .y}', '{.x\n .y}']) {
    expect(carveToHtml(`- +\n[^m]: n\n${attribute}\np\n`)).toBe(expected)
  }
  expect(carveToHtml('> - +\n> [^m]: n\n> {.x\n>  .y}\n> p\n')).toBe(
    '<blockquote>\n  <ul>\n    <li><p class="x y">p</p></li>\n  </ul>\n</blockquote>')
})
