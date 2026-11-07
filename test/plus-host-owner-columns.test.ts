import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('starts sibling items after a note takes a quote', () => {
  const source = '[^1]: +\n> q\n - y\n  - z\n\n[^1]\n'
  expect(carveToHtml(source)).toBe(`<ul>
  <li>y</li>
  <li>z</li>
</ul>
<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <blockquote><p>q</p></blockquote>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})

it.each([
  ['[^1]: +\n```\na\n\n  ```\n  c\n\n[^1]\n', '<pre><code>a\n</code></pre>\n      <pre><code>c\n\n</code></pre>'],
  [':: t\n: +\n```\na\n\n  ```\n  c\n', '<pre><code>a\n</code></pre>\n    <pre><code>c\n</code></pre>'],
])('only closes a plus-attached fence at its opener column', (source, expected) => {
  expect(carveToHtml(source)).toContain(expected)
})

it('keeps a blank inside a fence with a readable closer', () => {
  expect(carveToHtml('[^1]: +\n```\na\n\n```\n\n[^1]\n')).toContain('<pre><code>a\n\n</code></pre>')
})
