import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/malformed-colon-opener-absorbs-in-every-host.json'

// An invalid colon opener's paragraph absorbs the bare run below it and keeps a
// lazy line (CARVE-P9-016, PART 0 S3, S4), wherever the opener is written
// (markup-carve/carve#4112). Expected HTML from the spec model.
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a malformed colon opener absorbs the bare run below it: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
