import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// CARVE-P9-083 (carve#4504, carve#4496): an item on a note's marker line is measured
// from its own source column, so a line at its content column is the item's.
describe("a line at a note marker-line item's content column is the item's", () => {
  it.each([
    [
      'a div closer at the item\'s content column (carve#4504)',
      "[^f]: - :::::\n        :::::\n\n[^f]\n",
      "<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>\n          <div>\n\n          </div>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a table caption at the item\'s content column',
      "[^f]: - | a |\n        ^ cap\n\n[^f]\n",
      "<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>\n          <table>\n            <caption>cap</caption>\n            <tbody>\n              <tr><td>a</td></tr>\n            </tbody>\n          </table>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a quote caption at the item\'s content column',
      "[^f]: - > q\n        ^ cap\n\n[^f]\n",
      "<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>\n          <figure>\n            <blockquote><p>q</p></blockquote>\n            <figcaption>cap</figcaption>\n          </figure>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a heading at the item\'s content column stays in the item',
      "r[^f]\n\n[^f]: - a\n        # H\n",
      "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>a\n          <h1 id=\"H\">H</h1>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a quote past the content column stays in the item',
      "r[^f]\n\n[^f]: - a\n         > q\n",
      "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>a\n          <blockquote><p>q</p></blockquote>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a heading after a blank at the content column',
      "r[^f]\n\n[^f]: - a\n\n        # H\n",
      "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>a\n          <h1 id=\"H\">H</h1>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a heading below the column leaves for the note',
      "r[^f]\n\n[^f]: - a\n      # H\n",
      "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>a</li>\n      </ul>\n      <h1 id=\"H\">H</h1>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'depth 2: below the inner column, in the outer item (carve#4496)',
      "[^f]\n\n[^f]: - - a\n        # H\n",
      "<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>\n          <ul>\n            <li>a</li>\n          </ul>\n          <h1 id=\"H\">H</h1>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'an ordered lead item',
      "r[^f]\n\n[^f]: 1. a\n         # H\n",
      "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ol>\n        <li>a\n          <h1 id=\"H\">H</h1>\n        </li>\n      </ol>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a wider label',
      "r[^ff]\n\n[^ff]: - a\n         # H\n",
      "<p>r<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>a\n          <h1 id=\"H\">H</h1>\n        </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a sibling at the note\'s body column',
      "[^f]\n\n[^f]: - a\n  - b\n",
      "<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>a</li>\n        <li>b</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})

describe("the writer keeps a note marker-line item's lines at its content column", () => {
  it.each([
    'r[^f]\n\n[^f]: - a\n        # H\n',
    'r[^f]\n\n[^f]: - a\n\n        b\n',
    '[^f]: - | a |\n        ^ cap\n\n[^f]\n',
    'r[^ff]\n\n[^ff]: 1. a\n          # H\n',
  ])('%j', (source) => {
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
