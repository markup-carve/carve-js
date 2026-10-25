import { expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

it.each([
  ['<p>a\rb</p>', 'a b\n', '<p>a b</p>'],
  ['<p>a<strong>b\rc</strong>d</p>', 'a{*b c*}d\n', '<p>a<strong>b c</strong>d</p>'],
  ['<div>a\rb</div>', 'a b\n', '<p>a b</p>'],
  ['<p>\ra</p>', 'a\n', '<p>a</p>'],
])('normalizes a lone CR in HTML text: %s', (html, source, rendered) => {
  const result = htmlToCarve(html)
  expect(result.value).toBe(source)
  expect(carveToHtml(result.value)).toBe(rendered)
})
