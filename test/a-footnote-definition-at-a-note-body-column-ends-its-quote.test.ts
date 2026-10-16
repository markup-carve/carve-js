import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-footnote-definition-at-a-note-body-column-ends-its-quote.json'

// Expected HTML from the round-4 block-family differential (CARVE-P0-010, A QUOTE IS REACHED BY ITS MARKER).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a footnote definition at a note body column ends its quote: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
