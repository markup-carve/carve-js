import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-definition-shaped-text-line-registers-nothing.json'

// Expected HTML from the round-3 block-family differential (CARVE-P2-028).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a definition-shaped text line registers nothing: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
