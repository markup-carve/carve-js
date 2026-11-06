import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("ends a nested + attached fence at its blank when the closer stands below the item (carve-js#4567)", () => {
  expect(carveToHtml("- - +\n  ```\n\ntail\n```\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n<pre><code></code></pre>")
})

it("ends it when the line between is at the holding item column", () => {
  expect(carveToHtml("- - +\n  ```\n\n  tail\n```\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>\n<pre><code></code></pre>")
})

it("ends it three levels deep", () => {
  expect(carveToHtml("- - - +\n    ```\n\ntail\n```\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>\n<pre><code></code></pre>")
})

it("ends it inside a quote", () => {
  expect(carveToHtml("> - - +\n>   ```\n>\n> tail\n> ```\n").trim()).toBe("<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <pre><code></code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n  <p>tail</p>\n  <pre><code></code></pre>\n</blockquote>")
})

it("keeps an inner block after the blank and leaves a closer below the inner item out of it", () => {
  expect(carveToHtml("- - - +\n    ```\n\n    tail\n  ```\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n        <p>tail</p>\n      </li>\n    </ul>\n    <pre><code></code></pre>\n  </li>\n</ul>")
})

it("still closes the fence at a closer at the marker column", () => {
  expect(carveToHtml("- - +\n  ```\n\n  ```\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>")
})
