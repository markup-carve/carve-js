import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 9 §10 I4 / markup-carve/carve-js#1630, ruled on markup-carve/carve#1900.
 *
 * A fence at an item's block start runs to the END OF ITS CONTAINER, so an
 * unfinished fence opened on a NESTED item's marker lead owns the lines the
 * enclosing container folded in below its column - and a closing run written
 * among them is body text, because a fence's content is not re-scanned for
 * structure.
 *
 * This engine published an EMPTY `pre` and republished the body as prose in the
 * item ABOVE, with the closer coming back as an empty inline `code`. Every
 * expectation here is the executable spec's answer, read from
 * `scripts/spec/layout.mjs` into `scripts/spec/html.mjs` at spec 4ce23fe9.
 *
 * The OUTERMOST spelling is the control and must NOT move: with no container
 * above it, nothing was folded in, and the spec leaks the body to the document
 * exactly as this engine already did.
 */
describe('an unfinished fence on a nested item lead owns its body', () => {
  it("a flush-left body and closer", () => {
    expect(carveToHtml("- - ``` x\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">code\n```\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("a body indented below the content column", () => {
    expect(carveToHtml("- - ``` x\n code\n ```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">code\n```\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("three levels deep", () => {
    expect(carveToHtml("- - - ``` x\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code class=\"language-x\">code\n```\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("a quote as the host container", () => {
    expect(carveToHtml("> - ``` x\ncode\n```\n")).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\">code\n```\n</code></pre>\n    </li>\n  </ul>\n</blockquote>",
    )
  })

  it("ordered markers", () => {
    expect(carveToHtml("1. 1. ``` x\ncode\n```\n")).toBe(
      "<ol>\n  <li>\n    <ol>\n      <li>\n        <pre><code class=\"language-x\">code\n```\n</code></pre>\n      </li>\n    </ol>\n  </li>\n</ol>",
    )
  })

  it("no closer written at all", () => {
    expect(carveToHtml("- - ``` x\ncode\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">code\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("a closer as the only line below", () => {
    expect(carveToHtml("- - ``` x\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">```\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("a tilde fence", () => {
    expect(carveToHtml("- - ~~~ x\ncode\n~~~\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">code\n~~~\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("no info string", () => {
    expect(carveToHtml("- - ```\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>code\n```\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("a trailing sibling marker", () => {
    expect(carveToHtml("- - ``` x\ncode\n```\n- lazy\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">code\n```\n</code></pre>\n      </li>\n    </ul>\n  </li>\n  <li>lazy</li>\n</ul>",
    )
  })

  // Controls - these agreed with the spec already and must stay agreeing.
  it("the OUTERMOST spelling still leaks the body to the document", () => {
    expect(carveToHtml("- ``` x\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <pre><code class=\"language-x\">\n</code></pre>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it("a body AT the content column is unchanged", () => {
    expect(carveToHtml("- - ``` x\n    code\n    ```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">code\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("a blank line above the body is unchanged", () => {
    expect(carveToHtml("- - ``` x\n\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it("a colon container on the same lead is untouched", () => {
    expect(carveToHtml("- - ::: d\nbody\n:::\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>::: d\nbody</li>\n    </ul>\n  </li>\n</ul>\n<div>\n</div>",
    )
  })

  it('never leaks the internal frame into the output', () => {
    for (const src of Object.values({
      "R1-nested-flush": "- - ``` x\ncode\n```\n",
      "R2-nested-1space": "- - ``` x\n code\n ```\n",
      "R3-triple-nested": "- - - ``` x\ncode\n```\n",
      "R4-quote-host": "> - ``` x\ncode\n```\n",
      "R5-ordered": "1. 1. ``` x\ncode\n```\n",
      "R6-no-closer": "- - ``` x\ncode\n",
      "R7-closer-only": "- - ``` x\n```\n",
      "R8-tilde": "- - ~~~ x\ncode\n~~~\n",
      "R9-no-info": "- - ```\ncode\n```\n",
      "R10-lazy-tail": "- - ``` x\ncode\n```\n- lazy\n",
      "C1-depth1-flush": "- ``` x\ncode\n```\n",
      "C3-at-content-col": "- - ``` x\n    code\n    ```\n",
      "C5-blank-body": "- - ``` x\n\ncode\n```\n",
      "C4-div-nested": "- - ::: d\nbody\n:::\n",
      /*
       * A `=FORMAT` LEAD IS A FENCE TOO, and every row above is a CODE fence -
       * so without these the check could not fail. `leadFence` matches
       * `RE_RAW_FENCE` as well, the collector frames a raw fence's folded lines
       * exactly as it does a code fence's, and `parseRawBlock` did not strip the
       * frame the way `parseFence` does: the sentinel reached rendered output on
       * 180 of 400 nested raw-fence documents. Raised by `codex review`.
       */
      "R11-raw-html": "- - ```=html\n<b>x</b>\n```\n",
      "R12-raw-no-closer": "- - ```=html\n<b>x</b>\n",
      "R13-raw-tilde": "- - ~~~=html\n<b>x</b>\n~~~\n",
      "R14-raw-quote-host": "> - ```=html\n<b>x</b>\n```\n",
      "R15-raw-ordered": "1. 1. ```=html\n<b>x</b>\n```\n",
      "R16-raw-mismatched-closer": "- - ```=html\n<b>x</b>\n~~~\n",
      "C6-raw-depth1": "- ```=html\n<b>x</b>\n```\n",
    })) {
      expect(carveToHtml(src)).not.toContain('\u0000')
    }
  })

  /*
   * The frame comes off, and the folded closer stays BODY TEXT - the same two
   * halves `parseFence` gets, asserted on the raw arm so a future change cannot
   * satisfy the leak check above by dropping the line instead of unframing it.
   */
  it("a nested raw fence owns what the container folded in", () => {
    const out = carveToHtml("- - ```=html\n<b>x</b>\n```\n")
    expect(out).not.toContain('\u0000')
    expect(out).toContain("<b>x</b>")
    expect(out).toContain("```")
  })
})
