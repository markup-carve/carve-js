import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('reference definition after an unclosed fence', () => {
  it('is fence payload, not a definition', () => {
    expect(carveToHtml('- x\n```\n  [r]: l\n')).toBe(
      '<ul>\n  <li>x</li>\n</ul>\n<pre><code>  [r]: l\n</code></pre>',
    )
  })

  it('keeps ordinary text in the fence', () => {
    expect(carveToHtml('- x\n```\n  plain\n')).toBe(
      '<ul>\n  <li>x</li>\n</ul>\n<pre><code>  plain\n</code></pre>',
    )
  })
})
