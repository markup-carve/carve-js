import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-column-0-comment-does-not-retain-an-empty-description-note.json'

// Expected HTML from the executable spec at carve b9965c1b (PART 0 X1: a comment retains only a host with something to continue).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a column-0 comment does not retain an empty description note: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
