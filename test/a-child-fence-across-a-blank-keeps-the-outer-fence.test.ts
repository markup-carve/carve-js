import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalized = (html: string) => html.replace(/(<h[1-6]) id="[^"]*"/g, '$1').replace(/\s+/g, ' ').trim()

describe('a child fence that holds or follows a blank keeps the outer fence', () => {
  it.each([
    ["rebased grandchild fence after a blank", "- outer\n  - head1\n    - head2\n\n      ```\n\n  ```\n\n  tail\n  ```\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head1\n        <ul>\n          <li>head2\n            <pre><code>\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["closed child fence with a blank before an outer fence", "- outer\n  - head1\n    ````\n    a\n\n    b\n    ````\n  ```\n\n  tail\n  ```\n- next\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head1\n        <pre><code>a\n\nb\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n  <li>next</li>\n</ul>"],
    ["child fence opened after a blank before an outer fence", "- outer\n  - head1\n\n    ````\n    a\n\n    b\n    ````\n  ```\n\n  tail\n  ```\n- next\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head1\n        <pre><code>a\n\nb\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n  <li>next</li>\n</ul>"],
    ["closed child fence and outer fence", "- o\n  - h\n    ````\n    a\n\n    b\n    ````\n  ```\n\n  t\n  ```\n", "<ul>\n  <li>o\n    <ul>\n      <li>h\n        <pre><code>a\n\nb\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\nt\n</code></pre>\n  </li>\n</ul>"],
    ["backtick", "- outer\n  - head\n    ```\n    a\n   ```\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["tilde", "- outer\n  - head\n    ~~~\n    a\n   ~~~\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["ordered", "1. outer\n   - head\n     ```\n     a\n    ```\n\n   tail\n", "<ol>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ol>"],
    ["quote", "> - outer\n>   - head\n>     ```\n>     a\n>    ```\n>\n>   tail\n", "<blockquote>\n  <ul>\n    <li>outer\n      <ul>\n        <li>head\n          <pre><code>a\n</code></pre>\n        </li>\n      </ul>\n      <pre><code>\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>"],
    ["continuation", "- outer\n  - head\n    more\n    ```\n    a\n   ```\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\nmore\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["text after run", "- outer\n  - head\n    ```\n    a\n   ```\n   after\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>after\n\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["info string", "- outer\n  - head\n    ```js\n    a\n   ```\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code class=\"language-js\">a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["grandchild", "- outer\n  - child\n    - grand\n      ```\n      a\n     ```\n\n  tail\n", "<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>child\n        <ul>\n          <li>grand\n            <pre><code>a\n</code></pre>\n          </li>\n        </ul>\n        <pre><code>\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>"],
    ["second child", "- outer\n  - first\n  - second\n    ```\n    a\n   ```\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>first</li>\n      <li>second\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["two runs", "- outer\n  - head\n   ```\n   ~~~\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    <pre><code>~~~\n\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["heading child", "- outer\n  - head\n    # H\n    ```\n    a\n    ```\n\n  tail\n", "<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <h1 id=\"H\">H</h1>\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>"],
    ["marker heading", "- outer\n  - # H\n    ```\n    a\n   ```\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>\n        <h1 id=\"H\">H</h1>\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["blank before run", "- outer\n  - head\n\n    ```\n    a\n   ```\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["matching closer", "- outer\n  - head\n    ```\n    a\n    ```\n\n  tail\n", "<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>"],
    ["child column run", "- outer\n  - head\n    ```\n    a\n\n  tail\n", "<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <pre><code>a\n\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>"],
    ["outer continuation before run", "- outer\n  - head\n  more\n   ```\n   a\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\nmore</li>\n    </ul>\n    <pre><code>a\n\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["near child continuation before run", "- outer\n  - head\n   more\n  ```\n  a\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\nmore</li>\n    </ul>\n    <pre><code>a\n\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["outer quote", "- outer\n  - head\n  > q\n    ```\n    a\n   ```\n\n  tail\n", "<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head</li>\n    </ul>\n    <blockquote><p>q</p></blockquote>\n    <pre><code>a\n</code></pre>\n    <p>tail</p>\n  </li>\n</ul>"],
    ["comment opener", "- outer\n  - head\n    %%%\n    x\n    %%%\n    ```\n    a\n   ```\n\n  tail\n", "<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>"],
    ["colon opener", "- outer\n  - head\n    ::: note\n    x\n    :::\n    ```\n    a\n    ```\n\n  tail\n", "<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <aside class=\"admonition note\" aria-label=\"Note\">\n          <p>x</p>\n        </aside>\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>"]
  ])('%s matches the spec model', (_name, source, expected) => {
    expect(normalized(renderHtml(parse(source)))).toBe(normalized(expected))
  })
})
