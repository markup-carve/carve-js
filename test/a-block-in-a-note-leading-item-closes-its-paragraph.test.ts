import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("ends the host at a column-0 line after a heading in a note's leading item (carve-js#4546)", () => {
  expect(carveToHtml("- [^n]: - x\n          # H\nx\n\nr[^n]\n").trim()).toBe("<ul>\n  <li></li>\n</ul>\n<p>x</p>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>x\n          <h1 id=\"H\">H</h1>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("ends a description host the same way", () => {
  expect(carveToHtml(":: t\n: [^n]: - x\n          # H\nx\n\nr[^n]\n").trim()).toBe("<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>x</p>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>x\n          <h1 id=\"H\">H</h1>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("ends it after a closed fence in that item", () => {
  expect(carveToHtml("- [^n]: - x\n          ```\n          c\n          ```\nx\n\nr[^n]\n").trim()).toBe("<ul>\n  <li></li>\n</ul>\n<p>x</p>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>x\n          <pre><code>c\n</code></pre>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("still folds prose into the item's open paragraph", () => {
  expect(carveToHtml("- [^n]: - x\n          y\nx\n\nr[^n]\n").trim()).toBe("<ul>\n  <li></li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>x\ny\nx</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})
