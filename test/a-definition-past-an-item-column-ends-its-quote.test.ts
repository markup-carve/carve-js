import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-definition-past-an-item-column-ends-its-quote.json'

// Expected HTML from the executable spec (A QUOTE IS REACHED BY ITS MARKER, CARVE-P0-010, CARVE-P0-020).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a definition past an item column ends its quote: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
