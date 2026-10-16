import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-comment-retained-item-opens-an-unclosed-fence.json'

// Expected HTML from the block-family differential, the R3285 ruling extended to list items (PART 0 X1, CARVE-P0-013).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a comment-retained item opens an unclosed fence: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
