import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const source = '> - t\n^ p\n>   [^f]: n\nl\n\nr[^f]\n'

it('keeps a note below the caption of the quote above it', () => {
  const written = carveToCarve(source)
  expect(written).toBe('> - t\n^ p\n\n>\n\nr[^f]\n\n[^f]: n\n  l\n')
  expect(carveToHtml(written)).toBe(carveToHtml(source))
  expect(carveToCarve(written)).toBe(written)
})

it('keeps a note in the list it follows when no caption intervenes', () => {
  const written = carveToCarve('> - t\n>   [^f]: n\n>     x\n\nr[^f]\n')
  expect(carveToHtml(written)).toBe(carveToHtml('> - t\n>   [^f]: n\n>     x\n\nr[^f]\n'))
})
