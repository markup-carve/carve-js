import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-column-0-footnote-definition-ends-a-quoted-description.json'

// Expected HTML from the round-4 block-family differential (CARVE-P0-010, A QUOTE IS REACHED BY ITS MARKER).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a column-0 footnote definition ends a quoted description: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
