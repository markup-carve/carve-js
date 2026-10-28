import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps ordinary lazy text with an open footnote paragraph', () => {
  const html = carveToHtml('see[^n]\n\n[^n]: note\ntail\n')
  expect(html).not.toContain('<p>tail</p>')
  expect(html).toContain('<p>note\ntail<a href="#fnref1"')
})

it('ends a footnote paragraph at an interrupting block', () => {
  const html = carveToHtml('see[^n]\n\n[^n]: note\n# Heading\n')
  expect(html).toContain('<h1>Heading</h1>')
})
