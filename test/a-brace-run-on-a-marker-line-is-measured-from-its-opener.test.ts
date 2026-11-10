import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("ends a description at a column-0 line after a valid wrapped attribute on its marker line (carve#5753)", () => {
  expect(carveToHtml(":: t\n: {.x\n   }\nafter\n").trim()).toBe(
    "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>after</p>")
})

it("keeps the later lazy line of a refused run on a nested item lead (carve#5757)", () => {
  expect(carveToHtml("- - {.x\n   }\n    # h\nplain\n").trim()).toBe(
    "<ul>\n  <li>\n    <ul>\n      <li>{.x\n}\n        <h1 id=\"h\">h</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>plain</p>")
})

it("keeps the lazy line after a refused run when the closer is at the nested content column (carve#5757)", () => {
  expect(carveToHtml("- - {.x\n    }\n    # h\nplain\n").trim()).toBe(
    "<ul>\n  <li>\n    <ul>\n      <li>{.x\n}\n        <h1 id=\"h\">h</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>plain</p>")
})

it("keeps the inline payload of a fence follower after a nested refused run (carve#5758)", () => {
  expect(carveToHtml("- p\n  - {.x\n   }\n    ```\nplain\n").trim()).toBe(
    "<ul>\n  <li>p\n    <ul>\n      <li>{.x\n}\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>plain</p>")
})

it("keeps the lazy line after a refused run on a description marker line in an item", () => {
  expect(carveToHtml("- :: t\n  : {.x\n    }\n    # h\nplain\n").trim()).toBe(
    "<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <p>{.x\n}</p>\n        <h1 id=\"h\">h</h1>\n      </dd>\n    </dl>\n  </li>\n</ul>\n<p>plain</p>")
})

it("ends a nested item at a column-0 line after a valid wrapped attribute on its marker line", () => {
  expect(carveToHtml("- - {.x\n     }\nplain\n").trim()).toBe(
    "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>plain</p>")
})

it("ends a nested body item at a column-0 line after a valid wrapped attribute", () => {
  expect(carveToHtml("- p\n  - {.x\n     }\nplain\n").trim()).toBe(
    "<ul>\n  <li>p\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>plain</p>")
})
