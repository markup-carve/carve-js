import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("lets an indented fence after a lone `+` open a code block below a spaced break (carve-js#4566)", () => {
  expect(carveToHtml("- - -\n  +\n  ```\n").trim()).toBe("<hr>\n<p>+</p>\n<pre><code></code></pre>")
})

it("lets an indented fence interrupt a paragraph below a spaced break", () => {
  expect(carveToHtml("- - -\n  a\n  ```\n").trim()).toBe("<hr>\n<p>a</p>\n<pre><code></code></pre>")
})

it("lets an indented quote interrupt a paragraph below a spaced star break", () => {
  expect(carveToHtml("* * *\n  +\n  > q\n").trim()).toBe("<hr>\n<p>+</p>\n<blockquote><p>q</p></blockquote>")
})
