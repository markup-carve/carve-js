import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-list-marker-or-unclosed-fence-below-a-description-note-is-text.json'

// Expected HTML from the round-4 block-family differential (CARVE-P0-004, CARVE-P0-016, PART 9 §10 I2, I4).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a list marker or unclosed fence below a description note is text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
