import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P0-009 selects the deepest open paragraph in both hosts.

const cases: [string, string, string][] = [
  ["ticket", ":: t\n: - ```\n    ```\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code></code></pre>"],
  ["tilde", ":: t\n: - ```\n    ```\n~~~\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code></code></pre>"],
  ["info-string", ":: t\n: - ```\n    ```\n```js\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code class=\"language-js\"></code></pre>"],
  ["paragraph-continues", ":: t\n: - ```\n    ```\n```\nx\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code>x\n</code></pre>"],
  ["blank-ends-it", ":: t\n: - ```\n    ```\n```\n\nz\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code>\nz\n</code></pre>"],
  ["depth-two", ":: t\n: - - ```\n      ```\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code></code></pre>"],
  ["ctrl-closer-ahead", ":: t\n: - ```\n    ```\n```\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code></code></pre>"],
  ["ctrl-at-body-column", ":: t\n: ```\n  ```\n  ```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code></code></pre>\n    <pre><code></code></pre>\n  </dd>\n</dl>"],
  ["ctrl-nested-fence-open", ":: t\n: - ```\n```\n\n:: t\n```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code>```\n</code></pre>\n      </li>\n    </ul>\n  </dd>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  // No longer a fold: the inner item ends on a CLOSED fence, so no paragraph is
  // open at the deepest frame and the flush-left run is a block of its own
  // (markup-carve/carve#2884). This is the executable spec's output.
  ["ctrl-list-item-host", "- - ```\n    ```\n```\n", "<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code></code></pre>"],
  ["ctrl-plain-description-body", ":: t\n: ```\n```\n\n:: u\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code></code></pre>\n  </dd>\n</dl>\n<pre><code>\n:: u\n</code></pre>"],
  ["ctrl-raw-block-lead-body", ":: t\n: - =html\n```\n\n:: u\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>=html\n<code></code></li>\n    </ul>\n  </dd>\n  <dt>u</dt>\n</dl>"],
  ["ctrl-term-bare-fence", ":: t\n```\n", "<dl>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ["ctrl-heading-below", ":: t\n: - ```\n    ```\n# h\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<section id=\"h\">\n  <h1>h</h1>\n</section>"],
  ["ctrl-quote-below", ":: t\n: - ```\n    ```\n> q\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<blockquote><p>q</p></blockquote>"],
  ["ctrl-item-below", ":: t\n: - ```\n    ```\n- i\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<ul>\n  <li>i</li>\n</ul>"],
  ["ctrl-comment-fence-below", ":: t\n: - ```\n    ```\n%%%\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>"],
  ["ctrl-comment-line-below", ":: t\n: - ```\n    ```\n%% c\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>"],
  ["ctrl-quote-list-fence-flush", "> - ```\n```\n", "<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<pre><code></code></pre>"],
  ["ctrl-quote-list-fence", "> - ```\n> ```\n", "<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n  <pre><code></code></pre>\n</blockquote>"],
  ["ctrl-indented-fence-below", ":: t\n: - ```\n    ```\n ```\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p><code></code></p>"],
  ["ctrl-plain-text-below", ":: t\n: - ```\n    ```\nx\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>x</p>"],
  ["ctrl-line-block-lead", ":: t\n: - |\n| x\n\n:: u\n", "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>|\n| x</li>\n    </ul>\n  </dd>\n  <dt>u</dt>\n</dl>"],
]

describe('a closed nested fence lets the document read the next line', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      expect(carveToHtml(source).replace(/\n$/, '')).toBe(expected)
    })
  }
})
