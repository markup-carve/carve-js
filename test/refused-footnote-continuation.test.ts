import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a refused marker after a footnote definition', () => {
  expect(carveToHtml('[^a]: note\n+\n')).toBe('<p>+</p>')
})
