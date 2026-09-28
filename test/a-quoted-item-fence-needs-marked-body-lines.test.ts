import { it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// An unmarked line reaches no content column inside a quoted fence.
const cases = [
  [
    "> - ``` x\n    code\n    ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\">\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>code\n<code></code></p>"
  ],
  [
    "> - ``` x\n      code\n    tail\n    ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\">\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>code\ntail\n<code></code></p>"
  ],
  [
    "> - ``` x\n    code\n      ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\">\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>code\n<code></code></p>"
  ],
  [
    "> - ```=html\n    <b>hi</b>\n    ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      \n    </li>\n  </ul>\n</blockquote>\n<p>&lt;b&gt;hi&lt;/b&gt;\n<code></code></p>"
  ],
  [
    "> - - ``` x\n      code\n      ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <pre><code class=\"language-x\">\n</code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>\n<p>code\n<code></code></p>"
  ],
  [
    "> - ``` x\n>     code\n>     ```\n",
    "<blockquote>\n  <ul>\n    <li>\n      <pre><code class=\"language-x\">  code\n  ```\n</code></pre>\n    </li>\n  </ul>\n</blockquote>"
  ]
]

it.each(cases)('requires a quote marker for fence content: %s', (source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})
