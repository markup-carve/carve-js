import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L1 after carve#5015: a blank between two of an item's visible blocks loosens the list.
describe('a blank after a fence in a list item', () => {
  it("loosens the list at a blank between a closed fence and a heading", () => {
    expect(carveToHtml("- a\n  ```\n  c\n  ```\n\n  # h\n  x\n").trim()).toBe("<ul>\n  <li><p>a</p>\n    <pre><code>c\n</code></pre>\n    <h1 id=\"h\">h</h1>\n    <p>x</p>\n  </li>\n</ul>")
  })

  it("loosens the list at a blank between two closed fences", () => {
    expect(carveToHtml("- a\n  ```\n  one\n  ```\n\n  ~~~\n  two\n  ~~~\n").trim()).toBe("<ul>\n  <li><p>a</p>\n    <pre><code>one\n</code></pre>\n    <pre><code>two\n</code></pre>\n  </li>\n</ul>")
  })

  it("loosens the list at a blank after a closed fence below a refused plus", () => {
    expect(carveToHtml("- +\n  ```\n  c\n  ```\n\n  # h\n  x\n").trim()).toBe("<ul>\n  <li>\n    <pre><code>c\n</code></pre>\n    <h1 id=\"h\">h</h1>\n    <p>x</p>\n  </li>\n</ul>")
  })

  // The blank ends the pulled fence (PART 9 §17 L3) and separates it from the heading (carve#5367).
  it("loosens the list at the blank that ends a plus-pulled fence", () => {
    expect(carveToHtml("- +\n~~~\n\n  # h\n  x\n").trim()).toBe("<ul>\n  <li>\n    <pre><code></code></pre>\n    <h1 id=\"h\">h</h1>\n    <p>x</p>\n  </li>\n</ul>")
  })
})
