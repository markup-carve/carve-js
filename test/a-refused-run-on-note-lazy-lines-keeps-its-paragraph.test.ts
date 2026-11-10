import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (body: string): string =>
  "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>" +
  body + "<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"

it("ends a note's paragraph at a heading after a refused comment run on lazy lines (carve#5830)", () => {
  expect(carveToHtml("[^n]: p\n{% a\n%}\n  # q\nafter\n\nx[^n]\n").trim()).toBe("<p>after</p>\n" + note("p\n{% a\n%}</p>\n      <h1 id=\"q\">q</h1>\n      <p>"))
})

it("ends a note's paragraph at a heading when only the refused run's closer is lazy (carve#5830)", () => {
  expect(carveToHtml("[^n]: p\n  {% a\n%}\n  # q\nafter\n\nx[^n]\n").trim()).toBe("<p>after</p>\n" + note("p\n{% a\n%}</p>\n      <h1 id=\"q\">q</h1>\n      <p>"))
})

it("ends a note's paragraph at a heading after a three-line refused comment run (carve#5830)", () => {
  expect(carveToHtml("[^n]: p\n{% a\n  b\n%}\n  # q\nafter\n\nx[^n]\n").trim()).toBe("<p>after</p>\n" + note("p\n{% a\nb\n%}</p>\n      <h1 id=\"q\">q</h1>\n      <p>"))
})

it("leaves a refused run that continues a nested quote's paragraph to the quote", () => {
  const html = carveToHtml("[^n]: > p\n{% a\n%}\n  # q\nafter\n\nx[^n]\n").trim()
  expect(html.startsWith("<p>after</p>")).toBe(true)
  expect(html).toMatch(/<h1[^>]*>q<\/h1>/)
})
