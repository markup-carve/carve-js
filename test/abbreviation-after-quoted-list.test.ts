import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('registers an abbreviation after a closed quoted list', () => {
  expect(carveToHtml('> - b\n*[H]: L\n\nH\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>b</li>\n  </ul>\n</blockquote>\n<p><abbr title="L">H</abbr></p>',
  )
})

it('keeps an abbreviation-shaped line inside an open root item', () => {
  expect(carveToHtml('- b\n*[H]: L\n\nH\n')).toBe(
    '<ul>\n  <li>b\n*[H]: L</li>\n</ul>\n<p>H</p>',
  )
})
