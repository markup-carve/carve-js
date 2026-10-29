import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/an-unmarked-line-after-a-closed-block-in-a-deep-stack-closes-every-container.json'

// Expected HTML from the spec model: a quote in a nested item stack ends on its own last block, so a following unmarked line folds only into an open paragraph (PART 1 S4, carve#3955).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`an unmarked line after a closed block in a deep stack closes every container: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
