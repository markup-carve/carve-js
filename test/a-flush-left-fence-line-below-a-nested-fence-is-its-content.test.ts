import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases: [string, string, string][] = [
  ['ticket', ':: t\n: - ```\n```\n\n:: t\n```\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code>\n:: t\n</code></pre>"],
  ['depth-two', ':: t\n: - - ```\n```\n\n:: t\n```\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<pre><code>\n:: t\n</code></pre>"],
  ['term-bare-fence', ':: t\n```\n', "<dl>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ['term-tilde-fence', ':: t\n~~~\n', "<dl>\n  <dt>t</dt>\n</dl>\n<pre><code></code></pre>"],
  ['ctrl-closer-at-content-column', ':: t\n: - ```\n    ```\n\n:: t\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </dd>\n  <dt>t</dt>\n</dl>"],
  ['ctrl-fence-owns-its-content', ':: t\n: - ```\n  a\n```\n\n:: u\n: v\n', "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>a</p>\n  </dd>\n</dl>\n<pre><code>\n:: u\n: v\n</code></pre>"],
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
