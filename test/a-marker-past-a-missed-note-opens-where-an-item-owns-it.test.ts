import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-marker-past-a-missed-note-opens-where-an-item-owns-it.json'

// Expected HTML from the spec model: past a missed note a list marker opens in the item that owns it (PART 9 §10 I2, carve#3885).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a marker past a missed note opens where an item owns it: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
