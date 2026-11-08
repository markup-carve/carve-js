import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
const fence = '```'

// carve#5499 (nested host) and carve#5531 (top-level host): a later blank does not decide the reading.
describe('a sibling marker inside an unclosed fence a marker-line plus attached', () => {
  it('is payload at the top level when a blank and a paragraph follow (carve#5531)', () => {
    expect(carveToHtml(`- +\n${fence}\n- z\n\nq\n`)).toBe(`<ul>
  <li>
    <pre><code>- z
</code></pre>
  </li>
</ul>
<p>q</p>`)
  })

  const cases: Array<[string, string, string]> = [
    ['top level, no blank', `- +\n${fence}\n- z\n`, '<ul><li><pre><code>- z </code></pre></li></ul>'],
    ['top level, ordered marker', `- +\n${fence}\n1. z\n\nq\n`, '<ul><li><pre><code>1. z </code></pre></li></ul><p>q</p>'],
    ['ordered host, bullet marker', `1. +\n${fence}\n- z\n\n  y\n`, '<ol><li><pre><code>- z </code></pre></li></ol><p>y</p>'],
    ['nested, blank then column 0', `- - +\n  ${fence}\n  - z\n\nq\n`, '<ul><li><ul><li><pre><code>- z </code></pre></li></ul></li></ul><p>q</p>'],
    ['nested, no blank', `- - +\n  ${fence}\n  - z\n`, '<ul><li><ul><li><pre><code>- z </code></pre></li></ul></li></ul>'],
    ['nested below a paragraph', `- a\n  - +\n  ${fence}\n  - z\n\n    q\n`, '<ul><li>a <ul><li><pre><code>- z </code></pre><p>q</p></li></ul></li></ul>'],
  ]
  for (const [name, source, expected] of cases) {
    it(`is payload: ${name}`, () => {
      expect(flat(carveToHtml(source))).toBe(expected)
    })
  }
})
