import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("opens a fence after the blank that ends an unclosed + attached fence (carve-js#4579)", () => {
  expect(carveToHtml("- +\n```\n\n    ```\n").trim()).toBe("<ul>\n  <li>\n    <pre><code></code></pre>\n    <pre><code></code></pre>\n  </li>\n</ul>")
})

it("opens it one column past the content column", () => {
  expect(carveToHtml("- +\n```\n\n   ```\n").trim()).toBe("<ul>\n  <li>\n    <pre><code></code></pre>\n    <pre><code></code></pre>\n  </li>\n</ul>")
})

it("opens a tilde fence the same way inside a quote", () => {
  expect(carveToHtml("> - +\n> ~~~\n>\n>     ~~~\n").trim()).toBe("<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n</blockquote>")
})

it("keeps the attached fence open to a closer at its own column", () => {
  expect(carveToHtml("- +\n```\n\n```\n").trim()).toBe("<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>")
})

it("leaves a column-0 line after the blank to the document", () => {
  expect(carveToHtml("- +\n```\n\ntail\n  ```\n").trim()).toBe("<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>tail\n<code></code></p>")
})
