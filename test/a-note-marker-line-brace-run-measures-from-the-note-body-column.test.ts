import { expect, it } from "vitest"
import { carveToHtml } from "../src/index.js"

// carve corpus row 1053
it("keeps a note marker-line attribute run whose continuation sits at the note body column (carve#5748)", () => {
  expect(carveToHtml("[^n]: {.x\n    }\n    z\n\nr[^n]\n").trim()).toBe(
    "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p class=\"x\">z<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

// carve corpus row 1053-2
it("keeps a note marker-line comment run whose continuations sit at the note body column (carve#5748)", () => {
  expect(carveToHtml("[^n]: {% a\n    {k=v}\n    z %} y\n\nr[^n]\n").trim()).toBe(
    "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p> y<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

// carve corpus row 1053-3
it("keeps a note marker-line comment run whose continuations pass the written brace (carve#5748)", () => {
  expect(carveToHtml("[^n]: {% a\n       {k=v}\n       z %} y\n\nr[^n]\n").trim()).toBe(
    "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p> y<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})
