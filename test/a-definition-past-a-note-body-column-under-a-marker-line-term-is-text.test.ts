import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-definition-past-a-note-body-column-under-a-marker-line-term-is-text.json'

// Expected HTML from the executable spec (CARVE-P2-028, CARVE-P0-010).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a definition past a note body column under a marker-line term is text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
