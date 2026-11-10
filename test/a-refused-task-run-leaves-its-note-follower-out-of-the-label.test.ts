import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5830 rule A: a refused run claims no follower, so `[^m]: n` is a note definition.
it.each([
  [
    '- [ ] {.x\n      .y}\n[^m]: n\n',
    '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="{.x .y}"> {.x\n.y}</li>\n</ul>',
  ],
  ['[^q]: - [ ] {.x\n            .y}\n[^m]: n\n', ''],
  [
    '- [ ] read [^m] end\n',
    '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="read end"> read [^m] end</li>\n</ul>',
  ],
])('keeps a note follower out of a refused task run in %j (carve#5821)', (source, expected) => {
  expect(carveToHtml(source).trim()).toBe(expected)
})
