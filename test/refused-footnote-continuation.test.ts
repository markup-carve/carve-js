import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an accepted marker inside an unused footnote', () => {
  expect(carveToHtml('[^a]: note\n+\n')).toBe("")
})
