import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-comment-below-an-item-column-retains-an-item-ending-in-a-term.json'

// Expected HTML from the executable spec at carve d12a926b (CARVE-P2-028, PART 0 X1, carve#3285).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a comment below an item column retains an item ending in a term: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
