import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a task item measures its content column from its box', () => {
  it.each([
    ['-  [ ] item\n   > q\n', '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="item"> item\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>'],
    ['-  [ ] item\n  > q\n', '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="item"> item</li>\n</ul>\n<blockquote><p>q</p></blockquote>'],
    ['-   [ ] item\n\n   . x\n', '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="item"> item</li>\n</ul>\n<ol>\n  <li>x</li>\n</ol>'],
    ['- [ ] item\n  > q\n', '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="item"> item\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>'],
  ])('%j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
