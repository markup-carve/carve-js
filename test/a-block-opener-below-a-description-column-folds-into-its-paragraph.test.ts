import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-block-opener-below-a-description-column-folds-into-its-paragraph.json'

// Expected HTML from the round-4 block-family differential (carve#3295, PART 0 X2, CARVE-P0-021).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a block opener below a description column folds into its paragraph: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}

// The folded break is an em dash, so the writer must keep it below the column.
for (const row of fixtures) {
  it(`the written form keeps the fold: ${row.id}`, () => {
    expect(normalized(carveToHtml(carveToCarve(row.source)))).toBe(normalized(row.html))
  })
}
