import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Read by the spec model (scripts/spec/layout.mjs + html.mjs at markup-carve/carve d8a67aa).
const cases: ReadonlyArray<readonly [string, string]> = [
  ["> - > a\n>   +\n>   - s\n",
    "<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n        <p>a</p>\n        <ul>\n          <li>s</li>\n        </ul>\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>"],
  ["- > > q\n    +\n    b\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote><p>q\n+\nb</p></blockquote>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > > q\n    +\n    > r\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote><p>q\n+\nr</p></blockquote>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > > q\n    +\n    ```\n    c\n    ```\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote><p>q\n+</p></blockquote>\n    </blockquote>\n    <pre><code>c\n</code></pre>\n  </li>\n</ul>"],
  ["- > > q\n    +\n    # h\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote><p>q\n+</p></blockquote>\n    </blockquote>\n    <h1 id=\"h\">h</h1>\n  </li>\n</ul>"],
  ["- > > q\n    +\n    | a |\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote><p>q\n+</p></blockquote>\n    </blockquote>\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n  </li>\n</ul>"],
  ["- > - a\n    +\n    b\n",
    "<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>a\n+\nb</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > - a\n    +\n    > r\n",
    "<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>a\n+\nr</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > - a\n    +\n    ```\n    c\n    ```\n",
    "<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>a\n+</li>\n      </ul>\n    </blockquote>\n    <pre><code>c\n</code></pre>\n  </li>\n</ul>"],
  ["- > - a\n    +\n    # h\n",
    "<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>a\n+</li>\n      </ul>\n    </blockquote>\n    <h1 id=\"h\">h</h1>\n  </li>\n</ul>"],
  ["- > - a\n    +\n    | a |\n",
    "<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>a\n+</li>\n      </ul>\n    </blockquote>\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n  </li>\n</ul>"],
  ["- > > > q\n  >   +\n  >   b\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <blockquote><p>q\n+\nb</p></blockquote>\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > > > q\n  >   +\n  >   > r\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <blockquote><p>q\n+\nr</p></blockquote>\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > > > q\n  >   +\n  >   - s\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <blockquote><p>q\n+\n- s</p></blockquote>\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > > > q\n  >   +\n  >   ```\n  >   c\n  >   ```\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <blockquote><p>q\n+</p></blockquote>\n      </blockquote>\n      <pre><code>c\n</code></pre>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > > > q\n  >   +\n  >   # h\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <blockquote><p>q\n+</p></blockquote>\n      </blockquote>\n      <h1 id=\"h\">h</h1>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > > > q\n  >   +\n  >   | a |\n",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n        <blockquote><p>q\n+</p></blockquote>\n      </blockquote>\n      <table>\n        <tbody>\n          <tr><td>a</td></tr>\n        </tbody>\n      </table>\n    </blockquote>\n  </li>\n</ul>"],
  ["- > - > a\n  >   +\n  >   - s\n",
    "<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>\n          <blockquote>\n            <p>a</p>\n            <ul>\n              <li>s</li>\n            </ul>\n          </blockquote>\n        </li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>"],
]

describe('a plus on a line short of a quote prefix is paragraph text', () => {
  it.each(cases)('reads %j', (source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
