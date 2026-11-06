import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("folds a lazy line into the open div paragraph of a note leading an item (carve-js#4545)", () => {
  expect(carveToHtml("- - [^n]: ::: d\n      y\nx\n\nr[^n]\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <div class=\"d\">\n        <p>y\nx</p>\n      </div>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("folds it into a line block inside that div", () => {
  expect(carveToHtml("- - [^n]: ::: d\n      ::: |\n      w\nx\n\nr[^n]\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <div class=\"d\">\n        <div class=\"line-block\">\n          <p>w<br>\nx</p>\n        </div>\n      </div>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("folds it under a description item too", () => {
  expect(carveToHtml(":: t\n: - [^n]: ::: d\n      y\nx\n\nr[^n]\n").trim()).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <div class=\"d\">\n        <p>y\nx</p>\n      </div>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("takes no lazy line once the div paragraph has closed", () => {
  expect(carveToHtml("- - [^n]: ::: d\n      y\n\n      # H\nx\n\nr[^n]\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>\n<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <div class=\"d\">\n        <p>y</p>\n        <h1 id=\"H\">H</h1>\n      </div>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})
