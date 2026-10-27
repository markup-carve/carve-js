import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  [' ![a](u)\n^ c', '<figure>\n  <img src="u" alt="a">\n  <figcaption>c</figcaption>\n</figure>'],
  [' ![a](u)\n\n^ c', '<figure>\n  <img src="u" alt="a">\n  <figcaption>c</figcaption>\n</figure>'],
  ['>   ![a](u)\n> ^ c', '<blockquote>\n  <figure>\n    <img src="u" alt="a">\n    <figcaption>c</figcaption>\n  </figure>\n</blockquote>'],
  [' ![a](u)\n ^ c', '<p><img src="u" alt="a">\n^ c</p>'],
  [' ![a](u)\n\n\n^ c', '<img src="u" alt="a">\n<p>^ c</p>'],
])('attaches captions by their own column and gap: %s', (source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})
