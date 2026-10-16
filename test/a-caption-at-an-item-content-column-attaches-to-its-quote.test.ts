import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-caption-at-an-item-content-column-attaches-to-its-quote.json'

// Expected HTML from the executable spec at carve c841b089 (PART 9 §4, §10 I7).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a caption at an item content column attaches to its quote: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
