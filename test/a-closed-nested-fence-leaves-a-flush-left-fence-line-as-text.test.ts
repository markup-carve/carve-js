import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// ---------------------------------------------------------------------------
// A FLUSH-LEFT FENCE LINE BELOW A CLOSED NESTED FENCE IS LAZY PARAGRAPH TEXT
// (markup-carve/carve-js#2515).
//
// Where the nested lead's own fence is still open the flush-left line is that
// fence's verbatim content (carve#1958, corpus 455, and carve-js#2500). Where
// the body already closed it, nothing claims the line and §10 I5 answers on its
// own: below the content column the line is lazy paragraph text OF THIS
// CONTAINER, so the backtick run is an inline verbatim span and not a block.
//
// This engine folded the line in and then read its SHAPE again one level down,
// because the body's lines are dedented by its content margin and a flush-left
// fence line sits on the body's own column 0. The list-item host next door has
// clamped such a line to one column since carve-js#540 and already agreed with
// the spec; the description body is the same rule with a second answer.
//
// The clamp is the code fence's alone. This body's column 0 is not the author's,
// so a column added to a list marker opens a second list where the fold
// continues the first - `ctrl-item-below` is that row.
//
// Every expectation here is the executable spec's own output
// (`renderDoc(parse(source))`, the pinned `spec` submodule at `d3ba020`).
//
// The `ctrl-` rows keep the block reading, the verbatim reading or the host
// that was already right, so an over-wide clamp cannot pass as a fix.
// ---------------------------------------------------------------------------

const cases: [string, string, string][] = [
  ["ticket", ":: t\n: - ```\n    ```\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p><code></code></p>\n  </dd>\n</dl>"],
  ["tilde", ":: t\n: - ```\n    ```\n~~~\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>~~~</p>\n  </dd>\n</dl>"],
  ["info-string", ":: t\n: - ```\n    ```\n```js\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p><code>js</code></p>\n  </dd>\n</dl>"],
  ["paragraph-continues", ":: t\n: - ```\n    ```\n```\nx\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p><code>\nx</code></p>\n  </dd>\n</dl>"],
  ["blank-ends-it", ":: t\n: - ```\n    ```\n```\n\nz\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p><code></code></p>\n  </dd>\n</dl>\n<p>z</p>"],
  ["depth-two", ":: t\n: - - ```\n      ```\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n        <code></code>\n      </li>\n    </ul>\n  </dd>\n</dl>"],
  ["ctrl-closer-ahead", ":: t\n: - ```\n    ```\n```\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code></code></pre>"],
  ["ctrl-at-body-column", ":: t\n: ```\n  ```\n  ```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code></code></pre>\n    <pre><code></code></pre>\n  </dd>\n</dl>"],
  ["ctrl-nested-fence-open", ":: t\n: - ```\n```\n\n:: t\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code>```\n</code></pre>\n      </li>\n    </ul>\n  </dd>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ["ctrl-list-item-host", "- - ```\n    ```\n```\n", "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <code></code>\n  </li>\n</ul>"],
  ["ctrl-plain-description-body", ":: t\n: ```\n```\n\n:: u\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code></code></pre>\n  </dd>\n</dl>\n<pre><code>\n:: u\n</code></pre>"],
  ["ctrl-raw-block-lead-body", ":: t\n: - =html\n```\n\n:: u\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>=html\n<code></code></li>\n    </ul>\n  </dd>\n  <dt>u</dt>\n</dl>"],
  ["ctrl-term-bare-fence", ":: t\n```\n", "<dl>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ["ctrl-heading-below", ":: t\n: - ```\n    ```\n# h\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<section id=\"h\">\n  <h1>h</h1>\n</section>"],
  ["ctrl-quote-below", ":: t\n: - ```\n    ```\n> q\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<blockquote><p>q</p></blockquote>"],
  ["ctrl-item-below", ":: t\n: - ```\n    ```\n- i\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n      <li>i</li>\n    </ul>\n  </dd>\n</dl>"],
  ["ctrl-comment-fence-below", ":: t\n: - ```\n    ```\n%%%\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>"],
  ["ctrl-comment-line-below", ":: t\n: - ```\n    ```\n%% c\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>"],
  ["ctrl-quote-list-fence-flush", "> - ```\n```\n", "<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<pre><code></code></pre>"],
  ["ctrl-quote-list-fence", "> - ```\n> ```\n", "<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n  <pre><code></code></pre>\n</blockquote>"],
  ["ctrl-indented-fence-below", ":: t\n: - ```\n    ```\n ```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p><code></code></p>\n  </dd>\n</dl>"],
  ["ctrl-plain-text-below", ":: t\n: - ```\n    ```\nx\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>x</p>\n  </dd>\n</dl>"],
  ["ctrl-line-block-lead", ":: t\n: - |\n| x\n\n:: u\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>|\n| x</li>\n    </ul>\n  </dd>\n  <dt>u</dt>\n</dl>"],
]

describe('a closed nested fence leaves a flush-left fence line as text', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      expect(carveToHtml(source).replace(/\n$/, '')).toBe(expected)
    })
  }
})
