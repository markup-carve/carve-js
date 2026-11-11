import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('nested tab marker columns', () => {
  it('keeps identical tabbed markers as siblings in their item frame', () => {
    const source = '- a\n  - a\n  \t- a\n  \t- z\n'
    expect(carveToHtml(source)).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>a\n        <ul>\n          <li>a</li>\n          <li>z</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('keeps a block below a tabbed child with that child', () => {
    const source = '- o\n  -   e\n  \t> q\n'
    expect(carveToHtml(source)).toBe(
      '<ul>\n  <li>o\n    <ul>\n      <li>e\n        <blockquote><p>q</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('preserves marker-looking tabbed payload inside a code fence', () => {
    expect(carveToHtml('- a\n  ```\n   \t- x\n')).toBe(
      '<ul>\n  <li>a\n    <pre><code>  - x\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('keeps a tabbed fence-looking line and the next marker-looking line as payload', () => {
    expect(carveToHtml('- a\n  - b\n    ```\n  \t```\n  \t- z\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code></code></pre>\n        <ul>\n          <li>z</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
