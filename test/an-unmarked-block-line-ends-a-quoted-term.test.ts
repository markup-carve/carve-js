import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/an-unmarked-block-line-ends-a-quoted-term.json'

// Expected HTML from the round-3 block-family differential (CARVE-P2-028, carve#3284).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`an unmarked block line ends a quoted term: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
