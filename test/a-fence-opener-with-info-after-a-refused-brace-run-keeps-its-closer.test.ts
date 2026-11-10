/*
 * A refused brace run claims no lines, so a fence opener on the next line
 * interrupts its paragraph and opens a code block (carve#5830 rule A; this
 * replaced the carve-js#4434 follower reading).
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const quoted = '<blockquote><p>z</p></blockquote>'

describe('a fence opener after a refused brace run', () => {
  it.each([
    ['```py', '<pre><code class="language-py">k\n</code></pre>'],
    ['``` py', '<pre><code class="language-py">k\n</code></pre>'],
    ['```py "t"', '<pre title="t"><code class="language-py">k\n</code></pre>'],
    ['```py [l]', '<pre><code class="language-py">k\n</code></pre>'],
    ['``` =html', 'k'],
    ['~~~ js', '<pre><code class="language-js">k\n</code></pre>'],
  ])('opens a code block at %s', (opener, block) => {
    const closer = opener.startsWith('~') ? '~~~' : '```'
    expect(carveToHtml(`{x\ny}\n${opener}\nk\n${closer}\n> z\n`).trim()).toBe(`<p>{x\ny}</p>\n${block}\n${quoted}`)
  })

  it('opens the code block in an item after a plus', () => {
    expect(carveToHtml('- a\n+\n  {x\n  y}\n  ```py\n  k\n  ```\n  > z\n')).toBe(
      '<ul>\n  <li>a\n    {x\ny}\n    <pre><code class="language-py">k\n</code></pre>\n    ' + quoted + '\n  </li>\n</ul>')
  })
})
