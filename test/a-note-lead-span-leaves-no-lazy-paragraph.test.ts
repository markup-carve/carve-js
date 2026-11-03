// markup-carve/carve#4998 (PART 0 CARVE-P0-006, PART 9 §28): a %%% span on a note lead leaves no paragraph, so the
// line that misses the span's owner does not fold back into the item.
import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a note-lead %%% span leaves no lazy paragraph', () => {
  it.each([
    ['a note lead in an item', '- a\n  [^n]: %%%\n    n\nc\n',
      '<ul>\n  <li>a</li>\n</ul>\n<p>c</p>'],
    ['a note on the item marker line', '- [^n]: %%%\n    n\nc\n',
      '<ul>\n  <li></li>\n</ul>\n<p>c</p>'],
    ['a note lead in a nested item', '- - a\n    [^n]: %%%\n      n\nc\n',
      '<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>\n<p>c</p>'],
    ['a list-shaped payload line', '- a\n  [^n]: %%%\n    - n\nc\n',
      '<ul>\n  <li>a</li>\n</ul>\n<p>c</p>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
