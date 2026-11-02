import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A %%% run inside a descendant's code fence is that fence's payload, so the item opens no span on it (carve-js#4276). Outputs are the spec model's.
describe('a comment run in a descendant code fence opens no span in the item', () => {
  it.each([
    [
      "a span after a code fence in a nested item",
      "- a\n  - b\n    ```\n    %%%\n    ```\n    %%%\n    q\nx\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>%%%\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>",
    ],
    [
      "a closer-shaped payload line in a nested item",
      "- a\n  - b\n    ```\n    %%%\n    ```\n    q\nx\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>%%%\n</code></pre>\n        q\nx\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      "a nested item on the marker line",
      "- - b\n    ```\n    %%%\n    ```\n    %%%\n    q\nx\n",
      "<ul>\n  <li>\n    <ul>\n      <li>b\n        <pre><code>%%%\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>",
    ],
    [
      "a tilde fence two levels down",
      "- a\n  - b\n    - c\n      ~~~\n      %%%%\n      ~~~\n      q\nx\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>c\n            <pre><code>%%%%\n</code></pre>\n            q\nx\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      "a quoted nested item",
      "> - a\n>   - b\n>     ```\n>     %%%\n>     ```\n>     q\nx\n",
      "<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>b\n          <pre><code>%%%\n</code></pre>\n          q\nx\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>",
    ],
    [
      "CONTROL: the same run outside the fence opens a span",
      "- a\n  - b\n    %%%\n    q\nx\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trimEnd()).toBe(html)
  })
})
