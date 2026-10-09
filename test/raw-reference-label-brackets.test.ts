import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import sources from './fixtures/raw-reference-label-brackets.json'

it.each(sources)('preserves brackets in reference-bearing labels: %s', source => {
  const formatted = carveToCarve(source)
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})
