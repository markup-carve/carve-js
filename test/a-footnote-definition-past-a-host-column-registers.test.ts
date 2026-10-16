import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-footnote-definition-past-a-host-column-registers.json'

// Expected HTML from the round-3 block-family differential (CARVE-P0-010, CARVE-P0-020).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a footnote definition past a host's column registers: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
