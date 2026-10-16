import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-quote-does-not-rebase.json'

// Expected HTML is the executable spec's (carve#3280, corpus 615).
const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`reads a quoted line past the quote's column without a rebase: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
