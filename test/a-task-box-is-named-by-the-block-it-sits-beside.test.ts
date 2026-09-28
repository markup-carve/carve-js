import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A TASK BOX IS NAMED BY THE BLOCK IT SITS BESIDE (PART 2 `task_marker`,
 * markup-carve/carve#1468), which is the item's first child that renders
 * something rather than its first child.
 *
 * Read from index 0, the name went missing for every item whose marker line held
 * an invisible block. `- [ ] %%` with a folded line under it puts a comment first,
 * so a disabled checkbox reached a screen reader with no accessible name while the
 * word beside it was ordinary prose (markup-carve/carve-js#2292). The `<li>` line
 * already skips such a child to pick its lead paragraph, so the name and the text
 * the reader hears beside the box came from different blocks.
 *
 * Measured against the oracle - `scripts/spec/layout.mjs` into
 * `scripts/spec/html.mjs` in markup-carve/carve at `e24e38e9` - run rather than
 * read. Its layout records no block for a comment at all, so its own first-block
 * rule already reaches the folded paragraph.
 */

describe('a task box is named by the block it sits beside', () => {
  it.each([
    ['a comment line on the marker line', '- [ ] %%\n      tail\n', 'tail'],
    ['a comment fence on the marker line', '- [ ] %%%\n      x\n      %%%\n      tail\n', 'tail'],
    ['two comment lines above the paragraph', '- [ ] %%\n      %%\n      tail\n', 'tail'],
    ['a blank line between the comment and the paragraph', '- [ ] %%\n\n      tail\n', 'tail'],
    ['a checked box', '- [x] %%\n      tail\n', 'tail'],
  ])('names the box past %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toContain(`aria-label="${expected}"`)
  })

  // The controls. Each of these already agreed with the oracle, and the fix must
  // not move them: an item whose marker line carries text of its own names the box
  // from that text, and an item with no visible paragraph at all takes NO
  // attribute, because an empty name is worse than none.
  it.each([
    ['text on the marker line', '- [ ] a\n      tail\n', '<ul>\n  <li><input type="checkbox" disabled aria-label="a tail"> a\ntail</li>\n</ul>'],
    ['a comment below the marker line', '- [ ] a\n      %%\n      tail\n', '<ul>\n  <li><input type="checkbox" disabled aria-label="a"> a\n    tail\n  </li>\n</ul>'],
    ['a comment and nothing under it', '- [ ] %%\n', '<ul>\n  <li><input type="checkbox" disabled> </li>\n</ul>'],
    ['a heading where the paragraph would be', '- [ ] %%\n      # h\n      tail\n', '<ul>\n  <li><input type="checkbox" disabled> \n    <h1 id="h">h</h1>\n    tail\n  </li>\n</ul>'],
    ['no marker content at all', '- [ ]\n      tail\n', '<ul>\n  <li>[ ]\ntail</li>\n</ul>'],
  ])('leaves %s where it was', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
