import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-quoted-note-ends-its-quote-at-an-unmarked-line.json'

// Expected HTML from the round-1 block-family differential (CARVE-P0-004, CARVE-P0-011).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a quoted footnote ends its quote at an unmarked line: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
