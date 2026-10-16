import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-footnote-definition-that-ends-a-paragraph-opens-its-body.json'

// Expected HTML from the round-4 block-family differential (CARVE-P0-010, CARVE-P2-028, DEFINITION EXTENT).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a footnote definition that ends a paragraph opens its body: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
