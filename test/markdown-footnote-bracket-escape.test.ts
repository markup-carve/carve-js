import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['see [^\\].', '<p>see [^].</p>'],
  ['see [^name\\].', '<p>see [^name].</p>'],
  ['[^a\\] and [^b\\]', '<p>[^a] and [^b]</p>'],
])('decodes an inactive escaped closing bracket: %s', (markdown, html) => {
  expect(carveToHtml(markdownToCarve(markdown))).toBe(html)
})

it('keeps an escaped bracket inside an active link label', () => {
  expect(carveToHtml(markdownToCarve('[^a\\]b](/u)'))).toBe('<p><a href="/u">^a]b</a></p>')
})
