import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-line-below-a-task-box-sub-item-after-a-lazy-line.json'

// Expected HTML from the spec model: a lazy line does not move the column a task box's sub-item stands at.
for (const row of fixtures) {
  it(`a line below a task box sub-item after a lazy line: ${row.id}`, () => {
    expect(carveToHtml(row.source).trim()).toBe(row.html)
  })
}
