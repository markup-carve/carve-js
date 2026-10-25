import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  [
    'adjacent caption and ID',
    '$$`E=mc^2`{#eq-1}\n^ cap\n',
    '<figure>\n  <p><span class="math display" id="eq-1" role="math">\\[E=mc^2\\]</span></p>\n  <figcaption>cap</figcaption>\n</figure>',
  ],
  [
    'caption after one blank line and styled math',
    '$$`x+y`{.boxed data-k=v}\n\n^ Equation #: Sum\n',
    '<figure>\n  <p><span class="math display boxed" data-k="v" role="math">\\[x+y\\]</span></p>\n  <figcaption>Equation 1: Sum</figcaption>\n</figure>',
  ],
])('matches the merged C9 corpus row: %s', (_name, source, expected) => {
  expect(carveToHtml(source).trim()).toBe(expected)
})
