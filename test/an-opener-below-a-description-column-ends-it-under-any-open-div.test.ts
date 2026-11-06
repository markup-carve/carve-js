import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("ends a description at a fence below a note's div in its item (carve-js#4543)", () => {
  expect(carveToHtml(":: t\n: - [^n]: ::: d\n      ::: |\n      x\n```\n\nr[^n]\n").trim()).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<pre><code>\nr[^n]\n</code></pre>")
})

it("ends it at a heading below a line block opened later in the body", () => {
  expect(carveToHtml(":: t\n: x\n\n  ::: |\n  w\n# h\n").trim()).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <div class=\"line-block\">\n      <p>w</p>\n    </div>\n  </dd>\n</dl>\n<section id=\"h\">\n  <h1>h</h1>\n</section>")
})

it("ends it at a break below a div in a nested item", () => {
  expect(carveToHtml(":: t\n: - x\n    ::: e\n    w\n---\n").trim()).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>x\n        <div class=\"e\">\n          <p>w</p>\n        </div>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<hr>")
})

it("still folds prose into the open div paragraph", () => {
  expect(carveToHtml(":: t\n: x\n\n  ::: e\n  w\nz\n").trim()).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <div class=\"e\">\n      <p>w\nz</p>\n    </div>\n  </dd>\n</dl>")
})
