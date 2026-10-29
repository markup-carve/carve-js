import { it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// An unmarked line reaches no content column inside a quoted fence.
const cases = [
  [
    "> - ``` x\n    code\n    ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\"></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>code</p>\n<pre><code></code></pre>"
  ],
  [
    "> - ``` x\n      code\n    tail\n    ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\"></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>code\ntail</p>\n<pre><code></code></pre>"
  ],
  [
    "> - ``` x\n    code\n      ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\"></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>code</p>\n<pre><code></code></pre>"
  ],
  [
    "> - ```=html\n    <b>hi</b>\n    ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      \n    </li>\n  </ul>\n</blockquote>\n<p>&lt;b&gt;hi&lt;/b&gt;</p>\n<pre><code></code></pre>"
  ],
  [
    "> - - ``` x\n      code\n      ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <pre><code class=\"language-x\"></code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>\n<p>code</p>\n<pre><code></code></pre>"
  ],
  [
    "> - ``` x\n>     code\n>     ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\">  code\n  ```\n</code></pre>\n    </li>\n  </ul>\n</blockquote>"
  ]
]

it.each(cases)('requires a quote marker for fence content: %s', (source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})
