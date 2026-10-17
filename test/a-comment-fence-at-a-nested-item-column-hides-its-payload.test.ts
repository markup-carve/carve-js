import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import fixtures from './fixtures/a-comment-fence-at-a-nested-item-column-hides-its-payload.json'

// Expected HTML from the executable spec at carve b9965c1b (CARVE-P9-053: a matched fence answers as its `%%` twin).
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`a comment fence at a nested item column hides its payload: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}
