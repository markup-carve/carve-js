import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * THE HOST DOES NOT CHANGE WHICH COLUMN A DEFINITION REACHES
 * (markup-carve/carve-js#1610, the carve-js half of markup-carve/carve#1918;
 * the spec side pins it in corpus section 447).
 *
 * PART 0's AT OR PAST MEANS THE DEEPEST COLUMN THE LINE REACHES is written
 * about CONTAINERS, and DEFINITION BODIES FOLLOW THE SAME CONTAINER REACH RULE
 * names list items, definition bodies and footnote bodies as applying one rule.
 * So a definition written strictly BETWEEN two open content columns registers in
 * the OUTER one, whatever pair of hosts opened them.
 *
 * WHERE IT WENT WRONG IN carve-js, in two shapes and one place. The authored-base
 * rebase gives an over-indented opener a base of its own, and it does that for a
 * definition under every inner host - a description body, a list item, no inner
 * host at all - except one. A FOOTNOTE definition's run was measured as every
 * line at or past the DEFINITION's own column, so it swallowed the whole band
 * below the note's body column. The line then kept a column of residual indent,
 * where the strict column-0 rule reads a definition as text: a link definition
 * REGISTERED in the pre-pass and was published as characters as well, and a
 * footnote definition was neither registered nor invisible.
 *
 * A footnote body's column is ABSOLUTE - `parseFootnoteDef` admits a
 * continuation at column two of whatever coordinate system it is reading - so
 * the run's floor is whichever is deeper, the block's own base or that column.
 * Measuring `base + 2` instead cuts a NESTED definition's body off from it,
 * which the hoisting tests catch and which the last block here pins.
 *
 * A LINK reference definition owns no run at all: it is one line by
 * construction. Listing it beside the families that DO own body lines let it
 * swallow the line below, which is the row-15 shape - a second definition in the
 * band, published while the reference still resolved to it.
 *
 * ORACLE. `spec/scripts/spec/layout.mjs` into `spec/scripts/spec/html.mjs` at
 * spec main (0b0edf50). THE PIN MATTERS HERE: the pinned submodule (549f2a52)
 * predates carve#1918 and still answers the pre-ruling way, so measuring against
 * it scores this change backwards. Every expectation below is the corpus's own
 * `.html`, which the oracle at spec main reproduces byte-for-byte on all
 * twenty-four rows.
 */

describe('corpus 447: the host does not change which column a definition reaches', () => {
  it("row 1 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n   [r]: /url\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a</li>\n    </ul>\n  </dd>\n</dl>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 2 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n    [r]: /url\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a</li>\n    </ul>\n  </dd>\n</dl>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 3 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n     [r]: /url\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a</li>\n    </ul>\n  </dd>\n</dl>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 4 [control: already passing]", () => {
    expect(carveToHtml(":: t\n: - a\n   [r]: /url\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a</li>\n    </ul>\n  </dd>\n</dl>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 5 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:   - a\n     [r]: /url\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a</li>\n    </ul>\n  </dd>\n</dl>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 6 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  :: u\n   : d\n    [r]: /url\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <dl>\n      <dt>u</dt>\n      <dd>d</dd>\n    </dl>\n  </dd>\n</dl>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 7 [control: already passing]", () => {
    expect(carveToHtml("[^f]: b\n\n  - a\n   [r]: /url\n\nSee [r][] and [^f].\n")).toBe(
      "<p>See <a href=\"/url\">r</a> and <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>b</p>\n      <ul>\n        <li>a</li>\n      </ul>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("row 8 [control: already passing]", () => {
    expect(carveToHtml("[^f]: b\n\n  :: t\n  : d\n   [r]: /url\n\nSee [r][] and [^f].\n")).toBe(
      "<p>See <a href=\"/url\">r</a> and <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>b</p>\n      <dl>\n        <dt>t</dt>\n        <dd>d</dd>\n      </dl>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("row 9 [control: already passing]", () => {
    expect(carveToHtml("- x\n  :: t\n  : d\n   [r]: /url\n\nSee [r][].\n")).toBe(
      "<ul>\n  <li>x\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n    </dl>\n  </li>\n</ul>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 10 [MOVED by this change]", () => {
    expect(carveToHtml("- x\n  [^g]: b\n   [r]: /url\n\nSee [r][] and [^g].\n")).toBe(
      "<ul>\n  <li>x</li>\n</ul>\n<p>See <a href=\"/url\">r</a> and <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>b<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("row 11 [MOVED by this change]", () => {
    expect(carveToHtml("- x\n  [^g]: b\n   [^n]: note text\n\nSee [^n] and [^g].\n")).toBe(
      "<ul>\n  <li>x</li>\n</ul>\n<p>See <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a> and <a id=\"fnref2\" href=\"#fn2\" role=\"doc-noteref\"><sup>2</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>note text<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n    <li id=\"fn2\">\n      <p>b<a href=\"#fnref2\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("row 12 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n    [^n]: note text\n\nSee [^n].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a</li>\n    </ul>\n  </dd>\n</dl>\n<p>See <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>note text<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("row 13 [MOVED by this change]", () => {
    expect(carveToHtml(":: t\n: [^g]: b\n   [r]: /url\n\nSee [r][] and [^g].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>See <a href=\"/url\">r</a> and <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>b<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("row 14 [MOVED by this change]", () => {
    expect(carveToHtml("[^f]: b\n\n  [^g]: c\n   [^n]: note text\n\nSee [^n] and [^f] and [^g].\n")).toBe(
      "<p>See <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a> and <a id=\"fnref2\" href=\"#fn2\" role=\"doc-noteref\"><sup>2</sup></a> and <a id=\"fnref3\" href=\"#fn3\" role=\"doc-noteref\"><sup>3</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>note text<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n    <li id=\"fn2\">\n      <p>b<a href=\"#fnref2\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n    <li id=\"fn3\">\n      <p>c<a href=\"#fnref3\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("row 15 [MOVED by this change]", () => {
    expect(carveToHtml("- - x\n  [r]: /first\n   [r]: /second\n\nSee [r][].\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>\n<p>See <a href=\"/second\">r</a>.</p>",
    )
  })

  it("row 16 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n    *[HTML]: HyperText\n\nHTML here.\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n*[HTML]: HyperText</li>\n    </ul>\n  </dd>\n</dl>\n<p>HTML here.</p>",
    )
  })

  it("row 17 [control: already passing]", () => {
    expect(carveToHtml(":: t\n: d\n [r]: /url\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>d\n[r]: /url</dd>\n</dl>\n<p>See [r][].</p>",
    )
  })

  it("row 18 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n    more\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\nmore</li>\n    </ul>\n  </dd>\n</dl>",
    )
  })

  it("row 19 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  d\n    > q\ntail\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <blockquote><p>q\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })

  it("row 20 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n     [r]: /url\n     more\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n        more\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>See <a href=\"/url\">r</a>.</p>",
    )
  })

  it("row 21 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n     ```\n     [r]: /url\n     ```\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n        <pre><code>[r]: /url\n</code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>See [r][].</p>",
    )
  })

  it("row 22 [control: already passing]", () => {
    expect(carveToHtml("- a\n+\n```\n [r]: /url\n```\n\nSee [r][].\n")).toBe(
      "<ul>\n  <li>a\n    <pre><code> [r]: /url\n</code></pre>\n  </li>\n</ul>\n<p>See [r][].</p>",
    )
  })

  it("row 23 [control: already passing]", () => {
    expect(carveToHtml(":: t\n:  - a\n     %%%\n     [r]: /url\n     %%%\n\nSee [r][].\n")).toBe(
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a</li>\n    </ul>\n  </dd>\n</dl>\n<p>See [r][].</p>",
    )
  })

  it("row 24 [control: already passing]", () => {
    expect(carveToHtml("- a\n+\n[r]: /a\n[r]: /b\nmore\n\nSee [r][].\n")).toBe(
      "<ul>\n  <li>a\n    more\n  </li>\n</ul>\n<p>See <a href=\"/b\">r</a>.</p>",
    )
  })
})

describe("a footnote body's column is absolute, not measured from its definition", () => {
  it("a nested definition keeps the body written at its own column", () => {
    // Measuring the run as \`base + 2\` rather than \`max(base, 2)\` cut these
    // bodies off from their definitions.
    expect(carveToHtml("[^outer]: intro\n\n     [^inner]: note\n\n     see[^inner]\n\nsee[^outer]\n")).toBe(
      "<p>see<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>intro</p>\n      <p>see<a id=\"fnref2\" href=\"#fn2\" role=\"doc-noteref\"><sup>2</sup></a><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n    <li id=\"fn2\">\n      <p>note<a href=\"#fnref2\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("a body at column two is still the body", () => {
    // Measuring the run as \`base + 2\` rather than \`max(base, 2)\` cut these
    // bodies off from their definitions.
    expect(carveToHtml("[^f]: b\n  more\n\nSee [^f].\n")).toBe(
      "<p>See <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>b\nmore<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("a deeply indented body is still the body", () => {
    // Measuring the run as \`base + 2\` rather than \`max(base, 2)\` cut these
    // bodies off from their definitions.
    expect(carveToHtml("[^f]: b\n     more\n\nSee [^f].\n")).toBe(
      "<p>See <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>b\nmore<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })

  it("a body past the note column inside an item", () => {
    // Measuring the run as \`base + 2\` rather than \`max(base, 2)\` cut these
    // bodies off from their definitions.
    expect(carveToHtml("- x\n  [^g]: b\n    deeper\n\nSee [^g].\n")).toBe(
      "<ul>\n  <li>x</li>\n</ul>\n<p>See <a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a>.</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>b\ndeeper<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    )
  })
})
