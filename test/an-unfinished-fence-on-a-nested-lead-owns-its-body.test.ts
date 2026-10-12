import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an unfinished fence on a nested item lead owns its body', () => {
  it("a flush-left body and closer", () => {
    expect(carveToHtml("- - ``` x\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it("a body indented below the content column", () => {
    expect(carveToHtml("- - ``` x\n code\n ```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it("three levels deep", () => {
    expect(carveToHtml("- - - ``` x\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code class=\"language-x\"></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it('a quoted fence leaves unmarked lines outside', () => {
    expect(carveToHtml("> - ``` x\ncode\n```\n")).toBe("<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\"></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>code\n<code></code></p>")
  })

  it("ordered markers", () => {
    expect(carveToHtml("1. 1. ``` x\ncode\n```\n")).toBe(
      "<ol>\n  <li>\n    <ol>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ol>\n  </li>\n</ol>\n<p>code\n<code></code></p>",
    )
  })

  it("no closer written at all", () => {
    expect(carveToHtml("- - ``` x\ncode\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code</p>",
    )
  })

  it("a closer as the only line below", () => {
    expect(carveToHtml("- - ``` x\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code></code></pre>",
    )
  })

  it("a tilde fence", () => {
    expect(carveToHtml("- - ~~~ x\ncode\n~~~\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n~~~</p>",
    )
  })

  it("no info string", () => {
    expect(carveToHtml("- - ```\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it("a trailing sibling marker", () => {
    expect(carveToHtml("- - ``` x\ncode\n```\n- lazy\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n<code>\n- lazy</code></p>",
    )
  })

  // Controls - these agreed with the spec already and must stay agreeing.
  it("the OUTERMOST spelling still leaks the body to the document", () => {
    expect(carveToHtml("- ``` x\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <pre><code class=\"language-x\"></code></pre>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it("a body AT the content column is unchanged", () => {
    expect(carveToHtml("- - ``` x\n    code\n    ```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\">code\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it("a blank before an outside body stays outside the nested fence", () => {
    expect(carveToHtml("- - ``` x\n\ncode\n```\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code class=\"language-x\"></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>code\n<code></code></p>",
    )
  })

  it("a colon container on the same lead is untouched", () => {
    expect(carveToHtml("- - ::: d\nbody\n:::\n")).toBe(
      "<ul>\n  <li>\n    <ul>\n      <li>::: d\nbody</li>\n    </ul>\n  </li>\n</ul>\n<div>\n\n</div>",
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

  it("a nested raw fence owns what the container folded in", () => {
    const out = carveToHtml("- - ```=html\n<b>x</b>\n```\n")
    expect(out).not.toContain('\u0000')
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(out).toContain("<code></code>")
  })
})
