import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-nested-description-or-item-marker-reading.json'

// Expected HTML from the round-3 block-family differential (CARVE-P0-011, PART 0 O2, X2).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a nested description list or an item marker past it is read by its column: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
