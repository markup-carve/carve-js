import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('removes quote-column spaces from a lazy term continuation', () => {
  expect(carveToHtml('> : d\n> :: c\n  # H\n')).toBe(
    '<blockquote>\n  <p>: d</p>\n  <dl>\n    <dt>c\n# H</dt>\n  </dl>\n</blockquote>',
  )
})
