import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['**a**<strong>b</strong>', '*a*{*b*}', '<p><strong>a</strong><strong>b</strong></p>'],
  ['**left**<strong>right</strong>', '*left*{*right*}', '<p><strong>left</strong><strong>right</strong></p>'],
])('keeps adjacent Markdown and HTML strong spans: %s', (source, written, rendered) => {
  expect(markdownToCarve(source)).toBe(written)
  expect(carveToHtml(written)).toBe(rendered)
})
