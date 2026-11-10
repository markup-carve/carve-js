import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A marker-line run in a note's body is measured from its `{`, not the note body column (CARVE-P2-035).
const cases: Array<[string, string, string]> = [
  ["keeps the follower after a task item run refused at its `{` (carve-js#4868)",
    "[^q]: - [ ] {.x\n            .y}\nz\n\nx[^q]\n",
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled aria-label=\"{.x .y} z\"> {.x\n.y}\nz</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["keeps the follower after a task item run refused short of its `{`",
    "[^q]: - [ ] {.x\n           .y}\nz\n\nx[^q]\n",
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled aria-label=\"{.x .y} z\"> {.x\n.y}\nz</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["lets the follower leave after a task item run its `{` accepts",
    "[^q]: - [ ] {.x\n             .y}\nz\n\nx[^q]\n",
    "<p>z</p>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled> </li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["keeps the follower after a bullet item run refused at its `{`",
    "[^q]: - {.x\n        .y}\nz\n\nx[^q]\n",
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>{.x\n.y}\nz</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["keeps a note definition follower as item text",
    "[^q]: - {.x\n        .y}\n[^m]: n\n\nx[^q][^m]\n",
    "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a><a id=\"fnref2\" href=\"#fn2\" role=\"doc-noteref\"><sup>2</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>{.x\n.y}</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n    <li id=\"fn2\">\n      <p>n<a href=\"#fnref2\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["keeps the follower when the note sits in a list item",
    "- [^q]: - {.x\n          .y}\nz\n\nx[^q]\n",
    "<ul>\n  <li></li>\n</ul>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>{.x\n.y}\nz</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["keeps the follower when the note sits in a quote",
    "> [^q]: - {.x\n>         .y}\nz\n\nx[^q]\n",
    "<blockquote>\n\n</blockquote>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>{.x\n.y}\nz</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["keeps the follower after a quoted task item run refused at its `{`",
    "> [^q]: - [ ] {.x\n>             .y}\nz\n\nx[^q]\n",
    "<blockquote>\n\n</blockquote>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled aria-label=\"{.x .y} z\"> {.x\n.y}\nz</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["keeps the follower when a task item holds the note",
    "- [ ] [^q]: - {.x\n              .y}\nz\n\nx[^q]\n",
    "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled> </li>\n</ul>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li>{.x\n.y}\nz</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["measures a run on a task-held note head from that note body column",
    "- [ ] [^q]: {.x\n        .y}\nz\n\nx[^q]\n",
    "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled> </li>\n</ul>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>{.x\n.y}\nz<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
  ["measures a run behind a nested note head from that note body column",
    "[^q]: - [^r]: {.x\n           .y}\nz\n\nx[^q][^r]\n",
    "<p>z</p>\n<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a><a id=\"fnref2\" href=\"#fn2\" role=\"doc-noteref\"><sup>2</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <ul>\n        <li></li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n    <li id=\"fn2\">\n      <p><a href=\"#fnref2\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>"],
]

it.each(cases)('%s', (_name, source, html) => {
  expect(carveToHtml(source)).toBe(html)
})
