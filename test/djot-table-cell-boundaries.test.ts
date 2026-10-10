import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-table-cell-boundaries.json'

it.each(fixtures)('preserves table cell scopes: $name', ({ source, html }) => {
  const actual = carveToHtml(djotToCarve(source)).trim()
    .replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><')
  expect(actual).toBe(html)
})
