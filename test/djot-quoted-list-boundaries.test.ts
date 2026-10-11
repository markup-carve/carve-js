import { expect, test } from 'vitest'
import { djotToCarve, carveToHtml } from '../src/index.js'
import cases from './fixtures/djot-quoted-list-boundaries.json'

test.each(cases)('preserves quote and list ownership: $source', ({ source, carve }) => {
  expect(carveToHtml(djotToCarve(source))).toBe(carveToHtml(carve))
})
