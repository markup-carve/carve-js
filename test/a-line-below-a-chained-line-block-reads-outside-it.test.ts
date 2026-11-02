import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A line that misses the item holding a line block is read in the owner it reaches, so a fence opener there opens a fence that S1 then ends (carve#4966). Outputs are the spec model's.
describe("a line below a chained line block reads outside it", () => {
  it.each([
    [
      "the reproduction",
      "- - - ::: |\n    ~~~\nb\n",
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <div class=\"line-block\">\n\n            </div>\n          </li>\n        </ul>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>b</p>",
    ],
    [
      "a backtick fence",
      "- - - ::: |\n    ```\nb\n",
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <div class=\"line-block\">\n\n            </div>\n          </li>\n        </ul>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>b</p>",
    ],
    [
      "a stanza before the fence",
      "- - - ::: |\n      y\n    ~~~\nb\n",
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <div class=\"line-block\">\n              <p>y</p>\n            </div>\n          </li>\n        </ul>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>b</p>",
    ],
    [
      "four markers",
      "- - - - ::: |\n      ~~~\nb\n",
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <ul>\n              <li>\n                <div class=\"line-block\">\n\n                </div>\n              </li>\n            </ul>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>b</p>",
    ],
    [
      "CONTROL: two markers",
      "- - ::: |\n  ~~~\nb\n",
      "<ul>\n  <li>\n    <ul>\n      <li>\n        <div class=\"line-block\">\n\n        </div>\n      </li>\n    </ul>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>b</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
