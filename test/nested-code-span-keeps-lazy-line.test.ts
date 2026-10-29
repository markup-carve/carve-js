import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an unclosed fence in a nested list item', () => {
  it('ends at a flush-left line, which does not fold lazily', () => {
    expect(carveToHtml('- - a\n    ```` x\ntail\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n        <pre><code class="language-x"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('takes a line at the child indentation as payload', () => {
    expect(carveToHtml('- - a\n    ```` x\n    tail\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n        <pre><code class="language-x">tail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
