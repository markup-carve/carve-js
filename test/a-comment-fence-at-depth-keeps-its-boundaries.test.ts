import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends an unclosed item comment at the below-column document line', () => {
  expect(carveToHtml('- b\n  %%%\n  p\nx\n  %%%\n').trim()).toBe('<ul>\n  <li>b\n    p\n  </li>\n</ul>\n<p>x</p>')
})

// RE-SNAPSHOTTED at markup-carve/carve `3f97ff58` after markup-carve/carve#2527
// read a span's ownership from its OPENER's column: the span is a block of the
// item that opened it, so `tail` is the outer item's and no longer folds into
// the child. Both lists stay tight, which is what this row is here for.
it('does not make a nested list loose for a comment closer below its base', () => {
  expect(carveToHtml('- a\n  - b\n    %%%\n    p\n   %%%\n  tail\n').trim()).toBe('<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n    tail\n  </li>\n</ul>')
})

// Thirteen of these rows were re-snapshotted at the same spec SHA and for the
// same reason as the row above; each one recorded the pre-#2527 answer, where a
// trailing line folded back into the item the span belongs to.
const rows = JSON.parse(readFileSync(new URL('./fixtures/comment-fence-item-boundaries.json', import.meta.url), 'utf8')) as { source: string; html: string }[]
for (const [index, row] of rows.entries()) {
  it(`keeps comment ownership across delimiter columns, case ${index + 1}`, () => {
    expect(carveToHtml(row.source).trim()).toBe(row.html)
  })
}
