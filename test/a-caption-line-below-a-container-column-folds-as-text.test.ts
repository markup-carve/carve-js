import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-caption-line-below-a-container-column-folds-as-text.json'

// PART 9 §10 I7 as ruled for the block-family differential (M11): a caption line
// below a list item's or description's column reaches no host and folds as text;
// at the body column it still attaches.
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a caption line below a container column folds as text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
