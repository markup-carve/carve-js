import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-caption-below-a-marker-line-note-is-item-text.json'

// Expected HTML from the executable spec (PART 9 §4, §10 I7, CARVE-P0-010).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a caption below a marker-line note is item text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
