import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends an unclosed item comment at the below-column document line', () => {
  expect(carveToHtml('- b\n  %%%\n  p\nx\n  %%%\n').trim()).toBe('<ul>\n  <li>b\n    p\n  </li>\n</ul>\n<p>x</p>')
})

it('does not make a nested list loose for a comment closer below its base', () => {
  expect(carveToHtml('- a\n  - b\n    %%%\n    p\n   %%%\n  tail\n').trim()).toBe('<ul>\n  <li>a\n    <ul>\n      <li>b\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>')
})

const rows = JSON.parse(readFileSync(new URL('./fixtures/comment-fence-item-boundaries.json', import.meta.url), 'utf8')) as { source: string; html: string }[]
for (const [index, row] of rows.entries()) {
  it(`keeps comment ownership across delimiter columns, case ${index + 1}`, () => {
    expect(carveToHtml(row.source).trim()).toBe(row.html)
  })
}
