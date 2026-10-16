import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-block-past-an-item-column-leaves-no-paragraph.json'

// Expected HTML from the round-1 block-family differential (CARVE-P0-011).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a column-0 line after a block past an item's column leaves the item: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
