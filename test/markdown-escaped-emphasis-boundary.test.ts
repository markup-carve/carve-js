import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['_\\***x** q', '<p>_*<strong>x</strong> q</p>'],
  ['\\***x** q', '<p>*<strong>x</strong> q</p>'],
])('keeps active strong markup beside escaped punctuation: %s', (markdown, html) => {
  expect(carveToHtml(markdownToCarve(markdown))).toBe(html)
})
