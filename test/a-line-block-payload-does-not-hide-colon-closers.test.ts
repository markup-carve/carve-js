import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('closes nested colon frames after a fence-shaped line-block payload', () => {
  expect(carveToHtml('::: note\n::: |\n```\n:::\n:::')).toBe(
    '<aside class="admonition note" aria-label="Note">\n' +
    '  <div class="line-block">\n' +
    '    <p><code></code></p>\n' +
    '  </div>\n' +
    '</aside>',
  )
})

it('keeps an exact colon run inside a paired line-block code span', () => {
  expect(carveToHtml('::: note\n::: |\n```\n:::\n```\n:::\n:::')).toBe(
    '<aside class="admonition note" aria-label="Note">\n' +
    '  <div class="line-block">\n' +
    '    <p><code>\n:::\n</code></p>\n' +
    '  </div>\n' +
    '</aside>',
  )
})

it('keeps an exact colon run inside a paired line-block comment span', () => {
  expect(carveToHtml('::: note\n::: |\n%%%\n:::\n%%%\n:::\n:::')).toBe(
    '<aside class="admonition note" aria-label="Note">\n' +
    '  <div class="line-block">\n\n  </div>\n' +
    '</aside>',
  )
})

