import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-note-body-answers-the-container-rules-in-every-host.json'

// Expected HTML from the spec model: a note body takes lazy lines and first-block followers as every container does (carve#3885, CARVE-P9-067).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a note body answers the container rules in every host: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
