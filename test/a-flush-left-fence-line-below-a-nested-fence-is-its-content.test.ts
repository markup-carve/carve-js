import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// ---------------------------------------------------------------------------
// A FLUSH-LEFT FENCE LINE IS THE OPEN NESTED FENCE'S CONTENT
// (markup-carve/carve-js#2500).
//
// Column 0 is outside a description body, so under the ruling in
// markup-carve/carve#1958 (corpus 455) a flush-left fence line cannot close the
// fence the body's nested lead left open: it is that fence's verbatim content,
// and the entry below it survives as its own term.
//
// Two independent defects sat on this one document. The body collector ended on
// the flush-left line, because §10's interruption veto reads it as an opener, so
// the nested fence came out empty and the document took the line for a fresh
// fence that swallowed the next entry. The term then folded the trailing fence
// line in as text, because the same veto withholds interruption from a fence
// with no closer ahead to keep an OPEN PARAGRAPH's text intact, and a term is
// not a paragraph. `:: t` over a bare fence line reproduces the second half on
// its own, with no list and no body.
//
// The `ctrl-` rows keep a document-level fence or keep a line folded, so an
// over-suppression of either veto cannot pass as a fix.
// ---------------------------------------------------------------------------

const cases: [string, string, string][] = [
  ['ticket', ':: t\n: - ```\n```\n\n:: t\n```\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code>```\n</code></pre>\n      </li>\n    </ul>\n  </dd>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ['depth-two', ':: t\n: - - ```\n```\n\n:: t\n```\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code>```\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </dd>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ['term-bare-fence', ':: t\n```\n', "<dl>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ['term-tilde-fence', ':: t\n~~~\n', "<dl>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ['ctrl-closer-at-content-column', ':: t\n: - ```\n    ```\n\n:: t\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n  <dt>t</dt>\n</dl>"],
  ['ctrl-fence-owns-its-content', ':: t\n: - ```\n  a\n```\n\n:: u\n: v\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>a\n<code></code></p>\n  </dd>\n  <dt>u</dt>\n  <dd>v</dd>\n</dl>"],
  ['ctrl-term-indented-fence', ':: t\n   ```\n', "<dl>\n  <dt>t\n   <code></code></dt>\n</dl>"],
  ['ctrl-term-fence-closed-ahead', ':: t\n```\nx\n```\n', "<dl>\n  <dt>t</dt>\n</dl>\n<pre><code>x\n</code></pre>"],
  ['ctrl-plain-description-body', ':: t\n: ```\n```\n\n:: u\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code></code></pre>\n  </dd>\n</dl>\n<pre><code>\n:: u\n</code></pre>"],
  ['ctrl-list-item-host', '- ```\n```\n\nx\n', "<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<pre><code>\nx\n</code></pre>"],
  ['ctrl-line-block-lead', ':: t\n: - |\n| x\n\n:: u\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>|\n| x</li>\n    </ul>\n  </dd>\n  <dt>u</dt>\n</dl>"],
  ['ctrl-quote-list-fence', '> - ```\n> ```\n', "<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n  <pre><code></code></pre>\n</blockquote>"],
  ['ctrl-quote-list-fence-flush', '> - ```\n```\n', "<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<pre><code></code></pre>"],
  ['ctrl-raw-block-lead-body', ':: t\n: - =html\n```\n\n:: u\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>=html\n<code></code></li>\n    </ul>\n  </dd>\n  <dt>u</dt>\n</dl>"],
]

describe('a flush-left fence line below a nested fence', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      expect(carveToHtml(source).replace(/\n$/, '')).toBe(expected)
    })
  }
})
