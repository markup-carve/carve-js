import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-footnote-ending-a-quoted-item-takes-no-lazy-line.json'

// Expected HTML from the round-2 block-family differential (PART 0 O2-O4, DEFINITION EXTENT).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a footnote ending a quoted item takes no lazy line: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
