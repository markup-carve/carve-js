import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends a refused-run paragraph at a later heading in a description', () => {
  expect(carveToHtml(':: t\n: +\n  {.x\n  .y}\n  ```\n   # h\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>{.x\n.y}</p>\n    <pre><code> # h\n</code></pre>\n  </dd>\n</dl>')
})

it('ends a refused-run paragraph at a later heading in an item', () => {
  expect(carveToHtml('- +\n  {.x\n  .y}\n  ```\n   # h\n').trim()).toBe(
    '<ul>\n  <li>{.x\n.y}\n    <pre><code> # h\n</code></pre>\n  </li>\n</ul>')
})

it('ends a refused-run paragraph at a later heading in a footnote', () => {
  expect(carveToHtml('[^a]: +\n  {.x\n  .y}\n  ```\n   # h\n\nsee[^a]\n').trim()).toBe(
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
    '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
    '      <p>{.x\n.y}</p>\n      <pre><code> # h\n\n</code></pre>\n' +
    '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
    '    </li>\n  </ol>\n</section>')
})

it('opens a later list marker past a description body column', () => {
  expect(carveToHtml(':: t\n: +\n  {.x\n  .y}\n  ```\n   - li\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>{.x\n.y}</p>\n    <pre><code> - li\n</code></pre>\n  </dd>\n</dl>')
})
