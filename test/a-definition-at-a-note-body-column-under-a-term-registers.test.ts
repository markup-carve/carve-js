import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-definition-at-a-note-body-column-under-a-term-registers.json'

// Expected HTML from the round-4 block-family differential (CARVE-P2-028, CARVE-P0-010, DEFINITION EXTENT).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a definition at a note body column under a term registers: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
