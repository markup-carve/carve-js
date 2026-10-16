import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-matched-comment-fence-below-a-column-answers-as-a-comment-line.json'

// Expected HTML from the executable spec at carve b9965c1b (CARVE-P9-053, PART 0 X1).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a matched comment fence below a footnote body column answers as a comment line: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
