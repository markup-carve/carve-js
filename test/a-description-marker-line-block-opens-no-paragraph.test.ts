import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-description-marker-line-block-opens-no-paragraph.json'

// Expected HTML from the spec model at carve 4c9fd4dd (CARVE-P9-083, CARVE-P0-024, carve#4305).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a block on a description marker line opens no paragraph: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
