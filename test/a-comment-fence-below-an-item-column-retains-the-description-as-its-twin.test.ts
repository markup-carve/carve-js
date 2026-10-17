import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-comment-fence-below-an-item-column-retains-the-description-as-its-twin.json'

// Expected HTML from the executable spec at carve d12a926b (CARVE-P9-053, PART 0 X1).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a comment fence below an item column retains the description as its twin: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
