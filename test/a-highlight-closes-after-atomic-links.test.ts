import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('closes a highlight after an autolink or cross-reference atom', () => {
  expect(carveToHtml('=<https://x>=\n')).toBe('<p><mark><a href="https://x">https://x</a></mark></p>')
  expect(carveToHtml('=</#d>=\n')).toBe('<p><mark>&lt;/#d&gt;</mark></p>')
})

it('continues to read a comparison outside an atomic link', () => {
  expect(carveToHtml('a >= b\n')).toBe('<p>a ≥ b</p>')
})
