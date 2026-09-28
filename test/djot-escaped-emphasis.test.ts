import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

it.each([
  ['_\\__', '<p><em>_</em></p>'],
  ['_ab\\_c_', '<p><em>ab_c</em></p>'],
  ['_\u00a0a\u00a0_', '<p><em>&nbsp;a&nbsp;</em></p>'],
  ['a_b\\_c_d', '<p>a<em>b_c</em>d</p>'],
  ['\\_plain\\_', '<p>_plain_</p>'],
  ['_a\n\nb_', '<p>_a</p>\n<p>b_</p>'],
])('preserves Djot emphasis with escaped delimiters: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toBe(expected)
})
