import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// An unclosed fence a nested item's marker-line `+` attaches ends at its first blank (§17 L3,
// carve#5304), so a column-0 line after the paragraph that follows folds into it (PART 0 S4).
describe('a nested + fence ends at its blank for the enclosing item too', () => {
  it.each([
    [
      'the carve#5339 reproduction',
      '- a\n  - +\n  ```\n\n    p\ntail\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code></code></pre>\n        <p>p\ntail</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a fence with payload before the blank',
      '- a\n  - +\n  ```\n  c\n\n    p\ntail\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code>c\n</code></pre>\n        <p>p\ntail</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a tilde fence in an ordered sub-item',
      '- a\n  1. +\n  ~~~\n\n     p\ntail\n',
      "<ul>\n  <li>a\n    <ol>\n      <li>\n        <pre><code></code></pre>\n        <p>p\ntail</p>\n      </li>\n    </ol>\n  </li>\n</ul>",
    ],
    [
      'three levels deep',
      '- a\n  - b\n    - +\n    ```\n\n      p\ntail\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>\n            <pre><code></code></pre>\n            <p>p\ntail</p>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a closer at the fence column after the blank keeps the fence',
      '- a\n  - +\n  ```\n\n    p\n  ```\ntail\n',
      "<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code>\n  p\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
