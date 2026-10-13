import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import rows from './fixtures/mixed-nested-marker-note-fence.json'

it.each(rows)('keeps the tail outside the marker note after $id', ({ source, html }) => {
  expect(carveToHtml(source)).toBe(html)
})
