import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * AN OPENER AT OR PAST A DESCRIPTION BODY'S COLUMN CLOSES THE BODY'S PARAGRAPH
 * (markup-carve/carve-js#1604, the carve-js half of markup-carve/carve#1911;
 * the spec side landed as markup-carve/carve#1917 and pins it in corpus section
 * 444, and carve-php landed its half in markup-carve/carve-php#1873).
 *
 * `A NON-OPENER STILL FOLDS` is conditioned on an OPEN PARAGRAPH: a flush-left
 * line that opens nothing folds in because §10 I2's lazy continuation reaches
 * it. The two upper bands decide whether there is one. An opener AT the body's
 * column and an opener PAST it are both the body's own block content - at the
 * column it opens at the body's column 0, past it at the authored base ONE
 * AUTHORED BLOCK BASE gives it - so §10 I1 closes the paragraph for a visible
 * opener and §10 I5 closes it for a definition or an attribute block. The two
 * columns therefore answer alike; an answer that MOVES between the body's
 * column and one past it is reading indentation rather than the rule.
 *
 * WHERE IT WENT WRONG IN carve-js. `sliceColumns` removes the body's content
 * column and keeps the rest, so a heading one past it reached the §4 tracker as
 * ` # H`. Every VISIBLE-opener arm of that tracker is column-0 strict, so it
 * read prose and left the paragraph open - while `rebaseOverindentedBlocks`,
 * one pass later, gave the same line its authored base and the body parsed a
 * heading. The paragraph was decided from a spelling the body never reads. The
 * INVISIBLE arms are whitespace-tolerant and so were already right, which is
 * exactly the split between the rows that passed and the rows that did not.
 *
 * AN OPENER THAT LEAVES A PARAGRAPH OPEN IS NOT COVERED, and row 11 is the
 * control for it: a block quote opens inside the `dd`, its own paragraph is
 * still open, and the flush-left line continues THE QUOTE. Two sweeps widened
 * that carve-out past the single row, and the last two blocks pin what they
 * found. A `:::` container behaves exactly like the quote. And a quote
 * ABOVE the opener does too, wherever in the body it was opened: from there on
 * the innermost OPEN paragraph is the quote's, not the body's, so a line past
 * the column is the quote's lazy continuation and no body paragraph is left
 * for an opener to close. Missing that cost 114 documents of a
 * 36750-document sweep of quoted containers inside a description body, which
 * is the shape neither corpus behind this change could express.
 *
 * ORACLE. `spec/scripts/spec/layout.mjs` into `spec/scripts/spec/html.mjs` at
 * spec main (35148309). THE PIN MATTERS HERE, unlike most of these tickets: the
 * pinned submodule (549f2a52) predates carve#1917 and still answers the
 * pre-ruling way, so measuring against it scores this change backwards. Every
 * expectation below is the corpus's own `.html` file, which the oracle at spec
 * main reproduces byte-for-byte on all fifteen rows.
 */

describe('corpus 444: an opener at or past a description body column', () => {
  it("row 1: a link definition one past the column [control: carve-js was already right]", () => {
    expect(carveToHtml(":: term\n:  definition\n    [r]: /url\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition</dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 2: a link definition AT the column [control]", () => {
    expect(carveToHtml(":: term\n:  definition\n   [r]: /url\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition</dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 3: a heading one past the column [the reported document]", () => {
    expect(carveToHtml(":: term\n:  definition\n    # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 4: a heading AT the column [control: carve-js was already right]", () => {
    expect(carveToHtml(":: term\n:  definition\n   # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 5: a thematic break one past the column", () => {
    expect(carveToHtml(":: term\n:  definition\n    ***\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <hr>\n  </dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 6: a table row one past the column", () => {
    expect(carveToHtml(":: term\n:  definition\n    | a |\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n  </dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 7: an attribute block one past the column", () => {
    expect(carveToHtml(":: term\n:  definition\n    {.k}\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition</dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 8: an attribute block AT the column [control]", () => {
    expect(carveToHtml(":: term\n:  definition\n   {.k}\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition</dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 9: a comment one past the column [control]", () => {
    expect(carveToHtml(":: term\n:  definition\n    %% c\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition</dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 10: over-indented ordinary text, which opens nothing [control: both lines fold]", () => {
    expect(carveToHtml(":: term\n:  definition\n    more\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition\nmore\ntail</dd>\n</dl>",
    )
  })

  it("row 11: a block quote one past the column [control: tail continues the QUOTE]", () => {
    expect(carveToHtml(":: term\n:  definition\n    > q\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <blockquote><p>q\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })

  it("row 12: a four-space separator, heading at column 6", () => {
    expect(carveToHtml(":: term\n:    definition\n      # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("row 13: the same inside a list item", () => {
    expect(carveToHtml("- intro\n\n  :: term\n  :  definition\n      # H\n  tail\n")).toBe(
      "<ul>\n  <li>intro\n    <dl>\n      <dt>term</dt>\n      <dd>\n        <p>definition</p>\n        <h1 id=\"H\">H</h1>\n      </dd>\n    </dl>\n    tail\n  </li>\n</ul>",
    )
  })

  it("row 14: the line BELOW the ended body, one column in", () => {
    expect(carveToHtml(":: term\n:  definition\n    # H\n [r]: /url\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>\n<p>[r]: /url</p>",
    )
  })

  it("row 15: row 14's AT-column control [control]", () => {
    expect(carveToHtml(":: term\n:  definition\n   # H\n [r]: /url\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <h1 id=\"H\">H</h1>\n  </dd>\n</dl>\n<p>[r]: /url</p>",
    )
  })
})

describe('an opener that leaves a container OPEN is not covered', () => {
  it("admonition past the column", () => {
    expect(carveToHtml(":: term\n:  definition\n    ::: note\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <aside class=\"admonition note\" aria-label=\"Note\">\n      <p>tail</p>\n    </aside>\n  </dd>\n</dl>",
    )
  })

  it("admonition at the column [PRE-EXISTING divergence, pinned as carve-js reads it]", () => {
    // NOT the oracle's answer, and NOT moved by this change: at the column the
    // line is already flush, so the fix's test cannot reach it. carve-js ends
    // the body and lets `tail` escape the admonition, where the oracle keeps it
    // inside. Pinned so the divergence is visible rather than silent.
    expect(carveToHtml(":: term\n:  definition\n   ::: note\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <aside class=\"admonition note\" aria-label=\"Note\">\n\n    </aside>\n  </dd>\n</dl>\n<p>tail</p>",
    )
  })

  it("fence past the column", () => {
    expect(carveToHtml(":: term\n:  definition\n    ```\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition\n<code>\ntail</code></dd>\n</dl>",
    )
  })

  it("bullet past the column", () => {
    expect(carveToHtml(":: term\n:  definition\n    - m\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition\n- m\ntail</dd>\n</dl>",
    )
  })

  it("footnote definition past the column", () => {
    expect(carveToHtml(":: term\n:  definition\n    [^f]: n\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>definition</dd>\n</dl>\n<p>tail</p>",
    )
  })
})

describe('a quote above it means the body no longer owns the open paragraph', () => {
  it("a quote AT the column, heading one past it", () => {
    // Corpus 444 row 11 generalized: the quote's paragraph is the
    // innermost OPEN one, so a line past the column is ITS lazy
    // continuation and there is no body paragraph here for an opener to
    // close - tail continues the QUOTE. Without this gate the
    // quoted-container sweep lost 114 documents.
    expect(carveToHtml(":: term\n: definition\n  > q\n   # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <blockquote><p>q\n# H\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })

  it("a quote past the column, heading further past", () => {
    // Corpus 444 row 11 generalized: the quote's paragraph is the
    // innermost OPEN one, so a line past the column is ITS lazy
    // continuation and there is no body paragraph here for an opener to
    // close - tail continues the QUOTE. Without this gate the
    // quoted-container sweep lost 114 documents.
    expect(carveToHtml(":: term\n: definition\n   > q\n    # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <blockquote><p>q\n# H\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })

  it("a quote, then a table row past the column", () => {
    // Corpus 444 row 11 generalized: the quote's paragraph is the
    // innermost OPEN one, so a line past the column is ITS lazy
    // continuation and there is no body paragraph here for an opener to
    // close - tail continues the QUOTE. Without this gate the
    // quoted-container sweep lost 114 documents.
    expect(carveToHtml(":: term\n: definition\n  > q\n   | c |\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <blockquote><p>q\n| c |\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })

  it("a quote, then an attribute block past the column", () => {
    // Corpus 444 row 11 generalized: the quote's paragraph is the
    // innermost OPEN one, so a line past the column is ITS lazy
    // continuation and there is no body paragraph here for an opener to
    // close - tail continues the QUOTE. Without this gate the
    // quoted-container sweep lost 114 documents.
    expect(carveToHtml(":: term\n: definition\n  > q\n   {.k}\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <blockquote><p>q\n{.k}\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })
})

describe('a quote on the description MARKER line is already open', () => {
  it("a marker-line quote, heading past the column", () => {
    // The quote here never passes through the body's own loop - it is
    // seeded into the tracker from the MARKER line before the loop runs -
    // so a flag set while collecting cannot see it. This regressed on the
    // first shape of the fix and is the reason the gate asks the tracker's
    // CURRENT quote state as well.
    expect(carveToHtml(":: term\n: > q\n   # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <blockquote><p>q\n# H\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })

  it("the same with a wider separator", () => {
    // The quote here never passes through the body's own loop - it is
    // seeded into the tracker from the MARKER line before the loop runs -
    // so a flag set while collecting cannot see it. This regressed on the
    // first shape of the fix and is the reason the gate asks the tracker's
    // CURRENT quote state as well.
    expect(carveToHtml(":: term\n:  > q\n    # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <blockquote><p>q\n# H\ntail</p></blockquote>\n  </dd>\n</dl>",
    )
  })

  it('a quote that ENDED still suppresses the band [PRE-EXISTING divergence]', () => {
    // The oracle ends the body here; carve-js folds. That was already true
    // before this change and is unmoved by it - the flag stays set once a
    // quote has been seen, so the band simply does not reach this document.
    // Pinned so the remaining gap is visible rather than silent.
    expect(carveToHtml(":: term\n:  definition\n   > q\n\n   more\n    # H\ntail\n")).toBe(
      "<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <blockquote><p>q</p></blockquote>\n    <p>more\n# H\ntail</p>\n  </dd>\n</dl>",
    )
  })
})
