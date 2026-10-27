import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['**a**<strong>b</strong>', '*a*{*b*}', '<p><strong>a</strong><strong>b</strong></p>'],
  ['**left**<strong>right</strong>', '*left*{*right*}', '<p><strong>left</strong><strong>right</strong></p>'],
])('keeps adjacent Markdown and HTML strong spans: %s', (source, written, rendered) => {
  expect(markdownToCarve(source)).toBe(written)
  expect(carveToHtml(written)).toBe(rendered)
})

it.each([
  ['<strong>**x**</strong>', '{*{*x*}*}', '<p><strong><strong>x</strong></strong></p>'],
  ['<strong>**x** b</strong>', '{*{*x*} b*}', '<p><strong><strong>x</strong> b</strong></p>'],
  ['<strong>a **x** b</strong>', '{*a {*x*} b*}', '<p><strong>a <strong>x</strong> b</strong></p>'],
])('keeps nested strong spans inside imported HTML: %s', (source, written, rendered) => {
  expect(markdownToCarve(source)).toBe(written)
  expect(carveToHtml(written)).toBe(rendered)
})
