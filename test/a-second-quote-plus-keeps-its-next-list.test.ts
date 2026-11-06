import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a quote reclaims its next marker after an attached block', () => {
  it.each(['* e', '. e', '1. e'])('keeps a different list after %s', first => {
    expect(carveToHtml(`>\n+\n${first}\n+\n- y\n`)).toBe(
      `<blockquote>\n  ${first.startsWith('*') ? '<ul>' : '<ol>'}\n    <li>e</li>\n  ${first.startsWith('*') ? '</ul>' : '</ol>'}\n  <ul>\n    <li>y</li>\n  </ul>\n</blockquote>`,
    )
  })

  it('lets an indented follower continue the attached item', () => {
    const source = '>\n+\n- a\n+\n  ```\n  code\n  ```\n'
    expect(carveToHtml(source)).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>code\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('restores the quote before refusing a marker with a blank follower', () => {
    const source = '>\n+\n- a\n+\n\n  ```\n  c\n  ```\n'
    expect(carveToHtml(source)).toBe(
      '<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>\n<pre><code>c\n</code></pre>',
    )
  })
})
