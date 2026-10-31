import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-line-comment-before-an-attached-fence-keeps-the-fence-open.json'

// Expected HTML from the spec model: a line comment before a first-block + fence renders nothing,
// so the closerless fence still takes the rest of its container (CARVE-P9-067).
for (const row of fixtures) {
  it(`a line comment before an attached fence keeps the fence open: ${row.id}`, () => {
    expect(carveToHtml(row.source).trim()).toBe(row.html)
  })
}
