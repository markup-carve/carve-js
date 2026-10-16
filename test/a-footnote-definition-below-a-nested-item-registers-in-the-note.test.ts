import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-footnote-definition-below-a-nested-item-registers-in-the-note.json'

// Expected HTML from the executable spec at carve c841b089 (CARVE-P0-010, CARVE-P0-020).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a footnote definition below a nested item registers in the note: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
