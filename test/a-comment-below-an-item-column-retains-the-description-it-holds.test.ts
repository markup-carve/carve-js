import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-comment-below-an-item-column-retains-the-description-it-holds.json'

// Expected HTML from the executable spec (PART 0 X1, CARVE-P9-053).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a comment below an item column retains the description it holds: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
