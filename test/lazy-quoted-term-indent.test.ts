import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('removes quote-column spaces from a lazy term continuation', () => {
  expect(carveToHtml('> : d\n> :: c\n  # H\n')).toBe(
    '<blockquote>\n  <p>: d</p>\n  <dl>\n    <dt>c</dt>\n  </dl>\n</blockquote>\n<section id="H">\n  <h1>H</h1>\n</section>',
  )
})
