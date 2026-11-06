import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("gives a line below a note body to the document after a marker-line span ends (carve#5300)", () => {
  expect(carveToHtml("[^n]: a\n  . %%%\n    n\nzz\n\n[^n]\n").trim()).toBe("<p>zz</p>\n<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>a</p>\n      <ol>\n        <li></li>\n      </ol>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("still folds it into a note paragraph that a line missing the item opened", () => {
  expect(carveToHtml("[^n]: a\n  . %%%\n  n\nzz\n\n[^n]\n").trim()).toBe("<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>a</p>\n      <ol>\n        <li></li>\n      </ol>\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("keeps a comment line below a quoted item as payload of its line block span (carve#5300)", () => {
  expect(carveToHtml("> - ::: |\n>   x\n>   %%%\n> %% c\n> %%%\nmore\n").trim()).toBe("<blockquote>\n  <ul>\n    <li>\n      <div class=\"line-block\">\n        <p>x<br>\nmore</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>")
})
