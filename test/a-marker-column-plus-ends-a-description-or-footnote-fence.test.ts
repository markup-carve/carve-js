import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-marker-column-plus-ends-a-description-or-footnote-fence.json'

// Expected HTML from the executable spec at carve 3640844d (PART 9 §17 L3, L4).
const normalized = (html: string) => html.split('\n').map((line) => line.trimEnd()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a marker-column plus ends a description or footnote fence: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
