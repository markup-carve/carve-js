import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it("folds a lazy line into the item a sibling marker opens after a stacked span under a text item (carve#5281)", () => {
  expect(carveToHtml("- word\n  * * %%%\n    - m\nc\n").trim()).toBe("<ul>\n  <li>word\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n        <ul>\n          <li>m\nc</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>")
})

it("folds it after a three-deep stack", () => {
  expect(carveToHtml("- - - %%%\n    - m\nc\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n          <li>m\nc</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>")
})

it("folds it in a description body, where the marker ends a span opened behind a single marker", () => {
  expect(carveToHtml(":: t\n: x\n  * %%%\n  - m\nc\n").trim()).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <ul>\n      <li></li>\n    </ul>\n    <ul>\n      <li>m\nc</li>\n    </ul>\n  </dd>\n</dl>")
})
