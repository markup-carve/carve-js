import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'

// A closer below its fence's authored base closes the fence, so the item's
// paragraph after it takes a following lazy line (PART 0 S4).
const cases: Array<[string, string, string]> = [
  [
    'tab-authored opener and closer',
    '- a\n\n\t\t```\n\tcode\n\t```\n    tail\nafter\n',
    '<ul>\n  <li>a\n    <pre><code>code\n</code></pre>\n    tail\nafter\n  </li>\n</ul>',
  ],
  [
    'space-authored opener above the closer',
    '- a\n\n        ```\n  code\n    ```\n    tail\nafter\n',
    '<ul>\n  <li>a\n    <pre><code>code\n</code></pre>\n    tail\nafter\n  </li>\n</ul>',
  ],
  [
    'tab closer at a space opener',
    '- a\n        ```\n    code\n\t\t```\n    tail\nafter\n',
    '<ul>\n  <li>a\n    <pre><code>code\n</code></pre>\n    tail\nafter\n  </li>\n</ul>',
  ],
  [
    'quoted item',
    '> - a\n>\n> \t\t```\n> \tcode\n> \t```\n>     tail\n> after\n',
    '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>code\n</code></pre>\n      tail\nafter\n    </li>\n  </ul>\n</blockquote>',
  ],
]

describe('text after a closed raised fence stays in the item', () => {
  for (const [name, source, html] of cases) {
    it(name, () => {
      expect(carveToHtml(source)).toBe(html)
      expect(renderHtml(parse(source))).toBe(html)
    })
  }
})
