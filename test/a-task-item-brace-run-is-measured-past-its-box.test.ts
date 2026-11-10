import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("refuses a task item's marker-line attribute run whose continuation sits at its `{` (carve#5777)", () => {
  expect(carveToHtml("- [ ] {.x\n      .y}\nz\n").trim()).toBe(
    "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled aria-label=\"{.x .y} z\"> {.x\n.y}\nz</li>\n</ul>")
})

it("keeps a task item's marker-line attribute run whose continuation passes its `{` (carve#5777)", () => {
  expect(carveToHtml("- [ ] {.x\n       .y}\nz\n").trim()).toBe(
    "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled> </li>\n</ul>\n<p>z</p>")
})

it("measures a quoted task item's attribute run past its box (carve#5777)", () => {
  expect(carveToHtml("> - [ ] {.x\n>       .y}\n> z\n").trim()).toBe(
    "<blockquote>\n  <ul class=\"task-list\">\n    <li><input type=\"checkbox\" disabled aria-label=\"{.x .y} z\"> {.x\n.y}\nz</li>\n  </ul>\n</blockquote>")
})

it("measures a note-line comment run from the note's body column (CARVE-P2-035)", () => {
  expect(carveToHtml("[^n]: {% a\n   b %} y\n\nx[^n]\n").trim()).toContain(
    "<li id=\"fn1\">\n      <p> y<a href=\"#fnref1\"")
})
