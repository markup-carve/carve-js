import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-block-line-below-a-description-note-leaves-it.json'

// Expected HTML from the round-3 block-family differential (CARVE-P0-011, X1, CARVE-P0-013, carve#3285).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a block line below a note on a description marker leaves it: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
