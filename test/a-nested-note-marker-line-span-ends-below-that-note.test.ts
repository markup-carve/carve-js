import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A span on a nested note's marker line belongs to that note, so a line below its body ends it (PART 0 S1, carve-js#4276). Outputs are the spec model's.
describe("a nested note's marker-line span ends below that note", () => {
  it.each([
    [
      "the reproduction",
      "x[^g]\n\n[^g]: [^h]: %%%\n  n\nzz\n%%%%\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      "an info string on the opener",
      "x[^g]\n\n[^g]: [^h]: %%% c\n  n\nzz\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      "two spaces before the nested note",
      "x[^g]\n\n[^g]:  [^h]: %%%\n   n\nzz\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      "a comment line below the nested note stays in the span",
      "x[^g]\n\n[^g]: [^h]: %%%\n  %% c\n  secret\n  %%%\n  after\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>secret<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      "CONTROL: no span",
      "x[^g]\n\n[^g]: [^h]: q\n  n\nzz\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
