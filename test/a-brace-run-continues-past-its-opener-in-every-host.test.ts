import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("continues a block {% run past a brace line indented past its { (carve#5744)", () => {
  expect(carveToHtml("{% a\n {lang=de}\n z %} y\n").trim()).toBe(
    "<p> y</p>")
})

it("continues it past any brace line and two-space indentation (carve#5744)", () => {
  expect(carveToHtml("{% a\n  {.x}\n  {#i}\n  z %} y\n").trim()).toBe(
    "<p> y</p>")
})

it("keeps a list marker after a refused {% run on an item marker line as item text (carve#5745)", () => {
  expect(carveToHtml("- {% a\n  b %}\n  - q\n").trim()).toBe(
    "<ul>\n  <li>{% a\nb %}\n    <ul>\n      <li>q</li>\n    </ul>\n  </li>\n</ul>")
})

it("keeps an ordered marker after a refused run with trailing text as item text (carve#5745)", () => {
  expect(carveToHtml("- {% a\n  b %} c\n  1. q\n").trim()).toBe(
    "<ul>\n  <li>{% a\nb %} c\n    <ol>\n      <li>q</li>\n    </ol>\n  </li>\n</ul>")
})

it("keeps a marker after a refused run closed by a brace comment line as item text (carve#5745)", () => {
  expect(carveToHtml("- {% a\n  {%x%}\n  - q\n").trim()).toBe(
    "<ul>\n  <li>{% a\n\n    <ul>\n      <li>q</li>\n    </ul>\n  </li>\n</ul>")
})

it("keeps the follower of a refused attribute run in the footnote body (carve#5746)", () => {
  expect(carveToHtml("[^n]: {.x\n }\n z\n\nx[^n]\n").trim()).toBe(
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>{.x\n}\nz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("keeps a flush-left follower of a refused attribute run in the footnote body (carve#5746)", () => {
  expect(carveToHtml("[^n]: {.x\n }\nz\n\nx[^n]\n").trim()).toBe(
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>{.x\n}\nz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
})

it("ends an item at a brace line below its content column inside a {% run", () => {
  expect(carveToHtml("- {% a\n {lang=de}\n %}\n").trim()).toBe(
    "<ul>\n  <li>{% a</li>\n</ul>\n<p lang=\"de\">%}</p>")
})

it('ends a nested item at a sibling marker after its refused comment run', () => {
  expect(carveToHtml('- a\n  - b\n  {% c\nd %}\n  - z\n').trim()).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}</li>\n      <li>z</li>\n    </ul>\n  </li>\n</ul>')
})

it('ends a nested item at a sibling marker after its refused attribute run', () => {
  expect(carveToHtml('- a\n  - b\n  {.c\nd}\n  - z\n').trim()).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n{.c\nd}</li>\n      <li>z</li>\n    </ul>\n  </li>\n</ul>')
})

it('opens a heading in the outer item after a nested item refused run', () => {
  expect(carveToHtml('- a\n  - b\n  {.c\n  d}\n  # z\n').trim()).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n{.c\nd}</li>\n    </ul>\n    <h1 id="z">z</h1>\n  </li>\n</ul>')
})
