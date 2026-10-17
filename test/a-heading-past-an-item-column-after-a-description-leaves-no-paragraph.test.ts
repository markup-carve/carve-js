import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-heading-past-an-item-column-after-a-description-leaves-no-paragraph.json'

// Expected HTML from the executable spec (CARVE-P0-011, CARVE-P0-006: no claim, no lazy line).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a heading past an item column after a description leaves no paragraph: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
