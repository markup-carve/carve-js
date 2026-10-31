import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Cause tickets whose reproductions carve-js already renders as the spec model
// (carve#4212, carve#4363). Pinned so the reading cannot drift back.
describe('carve cause reproductions carve-js renders as the spec model', () => {
  it.each([
    [
      'carve#4212 reproduction 1',
      "[^b]: +\n # H\n\nr[^b]\n",
      "<section id=\"H\">\n  <h1>H</h1>\n  <p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n</section>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>+<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'carve#4212 reproduction 2',
      "- x\n  [^b]: +\n   # H\n\nr[^b]\n",
      "<ul>\n  <li>x\n    <h1 id=\"H\">H</h1>\n  </li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>+<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'carve#4363 reproduction 1',
      " * a\n - x\n",
      "<ul>\n  <li>a</li>\n</ul>\n<ul>\n  <li>x</li>\n</ul>",
    ],
    [
      'carve#4363 reproduction 2',
      "- p\n\n   * x\n   - y\n",
      "<ul>\n  <li>p\n    <ul>\n      <li>x</li>\n    </ul>\n    <ul>\n      <li>y</li>\n    </ul>\n  </li>\n</ul>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
