import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/no-paragraph-after-a-closed-block-in-a-description-body.json'

// Expected HTML from the round-1 block-family differential (CARVE-P0-011, PART 9 §10 I5).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a column-0 line after a closed block in a description body leaves it: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
