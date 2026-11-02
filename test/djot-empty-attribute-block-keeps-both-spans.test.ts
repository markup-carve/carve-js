import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

// `{ }` is the same empty attribute block as `{}`, so the spans beside it are braced (carve-js#4214).
it.each([
  ['*a*{ }*b*\n', '{*a*}{%%}{*b*}\n', '<p><strong>a</strong><strong>b</strong></p>'],
  ['*a*{  }*b*\n', '{*a*}{%%}{*b*}\n', '<p><strong>a</strong><strong>b</strong></p>'],
  ['_a_{ }_b_\n', '{/a/}{%%}{/b/}\n', '<p><em>a</em><em>b</em></p>'],
  ['*a*{}*b*\n', '{*a*}{%%}{*b*}\n', '<p><strong>a</strong><strong>b</strong></p>'],
])('keeps both spans around an empty attribute block: %j', (djot, carve, html) => {
  expect(djotToCarve(djot)).toBe(carve)
  expect(carveToHtml(djotToCarve(djot))).toBe(html)
})
