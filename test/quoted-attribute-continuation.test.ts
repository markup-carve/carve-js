import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an attribute opener whose continuation leaves its quote', () => {
  expect(carveToHtml('> {.a\n.b}\n')).toBe('<blockquote><p>{.a\n.b}</p></blockquote>')
})
