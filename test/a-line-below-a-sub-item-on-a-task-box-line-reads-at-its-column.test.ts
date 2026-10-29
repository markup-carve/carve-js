import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-line-below-a-sub-item-on-a-task-box-line-reads-at-its-column.json'

// Expected HTML from the spec model: a sub-item on a task item's marker line stands past the box, so the lines below it are read from its own column.
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a line below a sub-item on a task box line reads at its column: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
