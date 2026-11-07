import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 S4: a `: ` line at a nested item's marker column ends that item; below a
// quote's `+` description it folds lazily (carve-js#4607).
describe('colon lines below a nested item description', () => {
  it("ends an ordered inner item at its marker column under a bullet item", () => {
    expect(carveToHtml("- x\n  1. a\n      :: t\n      : d\n  : z\n").trim()).toBe("<ul>\n  <li>x\n    <ol>\n      <li>a\n        <dl>\n          <dt>t</dt>\n          <dd>d</dd>\n        </dl>\n      </li>\n    </ol>\n    : z\n  </li>\n</ul>")
  })

  it("ends a bullet inner item at its marker column under an ordered item", () => {
    expect(carveToHtml("1. x\n   - a\n     :: t\n     : d\n   : z\n").trim()).toBe("<ol>\n  <li>x\n    <ul>\n      <li>a\n        <dl>\n          <dt>t</dt>\n          <dd>d</dd>\n        </dl>\n      </li>\n    </ul>\n    : z\n  </li>\n</ol>")
  })

  it("ends an item opened on the marker line at its marker column", () => {
    expect(carveToHtml("- - a\n    :: t\n    : d\n  : z\n").trim()).toBe("<ul>\n  <li>\n    <ul>\n      <li>a\n        <dl>\n          <dt>t</dt>\n          <dd>d</dd>\n        </dl>\n      </li>\n    </ul>\n    : z\n  </li>\n</ul>")
  })

  it("ends an ordered quote-plus item at its marker column", () => {
    expect(carveToHtml("- x\n  1. > +\n      :: t\n      : d\n  : z\n").trim()).toBe("<ul>\n  <li>x\n    <ol>\n      <li>\n        <blockquote>\n\n        </blockquote>\n        <dl>\n          <dt>t</dt>\n          <dd>d</dd>\n        </dl>\n      </li>\n    </ol>\n    : z\n  </li>\n</ul>")
  })

  it("folds a lazy colon line below a quote-plus description", () => {
    expect(carveToHtml("- > +\n  :: t\n  : d\n : z\n").trim()).toBe("<ul>\n  <li>\n    <blockquote>\n      <dl>\n        <dt>t</dt>\n        <dd>d\n: z</dd>\n      </dl>\n    </blockquote>\n  </li>\n</ul>")
  })

  it("folds a lazy colon line below a nested quote-plus description", () => {
    expect(carveToHtml("- x\n  - > +\n    :: t\n    : d\n : z\n").trim()).toBe("<ul>\n  <li>x\n    <ul>\n      <li>\n        <blockquote>\n          <dl>\n            <dt>t</dt>\n            <dd>d\n: z</dd>\n          </dl>\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>")
  })

  it("folds a shifted colon line into a quoted description below the item content column", () => {
    expect(carveToHtml("- a\n  > +\n  :: t\n    : d\n : d\n").trim()).toBe("<ul>\n  <li>a\n    <blockquote>\n      <dl>\n        <dt>t</dt>\n        <dd>d\n: d</dd>\n      </dl>\n    </blockquote>\n  </li>\n</ul>")
  })
})
