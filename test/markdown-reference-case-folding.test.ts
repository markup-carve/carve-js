import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['[ẞ]\n\n[SS]: /url', '<p><a href="/url">ẞ</a></p>'],
  ['[SS]\n\n[ẞ]: /url', '<p><a href="/url">SS</a></p>'],
  ['[text][ẞ]\n\n[ss]: /url', '<p><a href="/url">text</a></p>'],
  ['[ẞ]\n\n[SS]: /first\n[ß]: /second', '<p><a href="/first">ẞ</a></p>'],
])('folds sharp-S reference labels without changing link text: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})
