import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P2-035: a block {% run whose continuations sit past its { holds them through %}, block-shaped lines included.

it("keeps a nested list marker inside an item marker-line {% run (carve#5809)", () => {
  expect(carveToHtml("- {% a\n   - m\n   z %} y\n").trim()).toBe(
    "<ul>\n  <li> y</li>\n</ul>")
})

it("keeps a nested marker inside a comment-only item run (carve#5809)", () => {
  expect(carveToHtml("- {% a\n   - m\n   z %}\n").trim()).toBe(
    "<ul>\n  <li></li>\n</ul>")
})

it("keeps an ordered marker inside an ordered item run (carve#5809)", () => {
  expect(carveToHtml("1. {% a\n    1. m\n    z %} y\n").trim()).toBe(
    "<ol>\n  <li> y</li>\n</ol>")
})

it("keeps a marker inside a run that continues an item paragraph (carve#5809)", () => {
  expect(carveToHtml("- p\n  {% a\n   - m\n   z %}\n").trim()).toBe(
    "<ul>\n  <li>p\n</li>\n</ul>")
})

it("keeps a marker inside a run in a nested quoted item (carve#5809)", () => {
  expect(carveToHtml("> - {% a\n>    - m\n>    z %} y\n").trim()).toBe(
    "<blockquote>\n  <ul>\n    <li> y</li>\n  </ul>\n</blockquote>")
})

it("keeps a quote-shaped line inside an item run (carve-js#4856)", () => {
  expect(carveToHtml("- {% a\n   > m\n   z %}\n").trim()).toBe(
    "<ul>\n  <li></li>\n</ul>")
})

it("keeps a thematic break inside a root {% run (carve-js#4856)", () => {
  expect(carveToHtml("{% a\n ---\n z %}\n").trim()).toBe(
    "")
})

it("keeps a spaced thematic break inside a run after a paragraph line (carve-js#4856)", () => {
  expect(carveToHtml("p\n{% a\n * * *\n z %} y\n").trim()).toBe(
    "<p>p\n y</p>")
})

it("keeps a %% line inside a root {% run (carve-js#4856)", () => {
  expect(carveToHtml("{% a\n %% c\n z %}\n").trim()).toBe(
    "")
})

it("keeps a thematic break inside an item run (carve-js#4856)", () => {
  expect(carveToHtml("- {% a\n   ---\n   z %}\n").trim()).toBe(
    "<ul>\n  <li></li>\n</ul>")
})
