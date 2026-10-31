import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-list-marker-at-an-item-content-column-ends-a-quote-caption.json'

// Expected HTML from the executable spec at carve 3640844d (CARVE-P2-021, PART 9 §24 C3).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a list marker at an item content column ends a quote caption: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
