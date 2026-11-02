import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/malformed-colon-opener-absorbs-in-every-host.json'

// An invalid colon opener is paragraph text and leaves no state, so the bare run
// below it opens a div wherever the opener is written (carve#4863, which replaced
// the absorption of carve#4112). Expected HTML from the spec model.
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a malformed colon opener leaves the bare run below it a fence: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
