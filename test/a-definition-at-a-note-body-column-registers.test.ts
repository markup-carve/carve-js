import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-definition-at-a-note-body-column-registers.json'

// Expected HTML from the round-1 block-family differential (DEFINITION EXTENT, CARVE-P0-010, CARVE-P0-020).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a definition at a footnote body's column registers in the note: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
