import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-footnote-definition-below-every-open-column-is-lazy-text.json'

// Expected HTML from the round-4 block-family differential (CARVE-P0-010, CARVE-P0-020, CARVE-P0-011).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a footnote definition below every open column is lazy text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
