import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-below-column-line-under-an-open-paragraph-is-lazy-text.json'

// Expected HTML from the round-1 block-family differential (PART 9 §10 I2/I4, X2, CARVE-P0-021, carve#3284).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a below-column line under an open nested paragraph is lazy text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
