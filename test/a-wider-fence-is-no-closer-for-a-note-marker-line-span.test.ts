import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A %%% on a note's marker line with no exact-width closer ahead is a %% line
// comment (PART 0 recovery table), so a wider fence below does not end the note
// (carve-js#4230). Outputs are the spec model's.
describe('a wider fence is no closer for a note marker-line span', () => {
  it.each([
    [
      'the reproduction: a wider fence below',
      "x[^g]\n\n[^g]: %%%\n  n\nzz\n%%%%\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a fence two wider',
      "x[^g]\n\n[^g]: %%%\n  n\nzz\n%%%%%\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a %%%% opener and a wider fence',
      "x[^g]\n\n[^g]: %%%%\n  n\nzz\n%%%%%\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'a nested note on the marker line',
      "x[^g]\n\n[^g]: [^h]: %%%\n  n\nzz\n%%%%\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n\nzz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'an item that holds the note',
      "- [^g]: %%%\n  n\nzz\n%%%%\n\nx[^g]\n",
      "<ul>\n  <li>n\nzz</li>\n</ul>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'an exact-width closer still ends the note',
      "x[^g]\n\n[^g]: %%%\n  n\nzz\n%%%\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<p>zz</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>n<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
