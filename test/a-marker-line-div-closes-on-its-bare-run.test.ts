import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-marker-line-div-closes-on-its-bare-run.json'

// Expected HTML from the spec model at carve 4c9fd4dd (CARVE-P9-016, PART 0 S4, carve#4397).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a div opened on a marker line closes on its bare run: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
