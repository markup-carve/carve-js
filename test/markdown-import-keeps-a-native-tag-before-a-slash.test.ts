import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

// A native tag's own slash is markup the tag rules convert, not a text delimiter.
it.each([
  ['<u>z</u>/y/\n', '_z_\\/y/\n'],
  ['<u>z</u>/\n', '_z_/\n'],
  ['<mark>z</mark>/y/\n', '=z=\\/y/\n'],
  ['a <ins>z</ins>/y/\n', 'a {+z+}\\/y/\n'],
  ['<u>z</u> y\n', '_z_ y\n'],
])('imports %j as %j', (markdown, carve) => {
  expect(markdownToCarve(markdown)).toBe(carve)
})

it.each(['_z_/y/', '_z_/', '_z_ y'])('round-trips %j through Markdown', source => {
  expect(carveToHtml(markdownToCarve(carveToMarkdown(source)))).toBe(carveToHtml(source))
})
