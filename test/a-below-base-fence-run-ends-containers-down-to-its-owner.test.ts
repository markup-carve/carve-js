import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A run written below its fence's base is not a closer, and it does not leave
 * the fence's host standing either (markup-carve/carve#2490, ruled as reading A
 * on markup-carve/carve-php#2610's family 1; corpus category 509).
 *
 * While any container in the open stack holds an open paragraph the run folds
 * there and nothing ends. Otherwise CARVE-P0-004's owner table picks the nearest
 * surviving ancestor whose content column the run reaches: everything between
 * the fence's host and that owner closes, the fence ends unterminated, and the
 * run is classified in the survivor at its own column. No depth cap, and `%%%`
 * is out by name.
 *
 * The defect was the enclosing item's own paragraph state. Its tracker reads
 * each collected line at its own dedent and its opener test is anchored, so a
 * fence written at a CHILD's column reached no branch of the classifier and the
 * item recorded the open paragraph that line looks like. The below-base run then
 * folded into a paragraph the deepest structure did not hold - which is the same
 * root cause markup-carve/carve#2509 found in the oracle, and why every reader
 * agrees at depth 1.
 *
 * The CONTROLS are what a fix reaching one column too far breaks, and six of them
 * came out of review passes rather than out of the sweep: an over-indented fence
 * whose closer stands at its holding item's column, a closer at an INTERMEDIATE
 * item's column which is neither of the two CARVE-P0-004 allows, a fence-shaped
 * line inside a descendant's COMMENT payload which §28 makes verbatim, a
 * comment-shaped line inside a descendant's CODE payload which must not hide the
 * real closer, and an ancestor's own block below the child's column, which ends
 * the descendant whatever the line says.
 *
 * Every expectation is the oracle's (`scripts/spec/layout.mjs` into
 * `scripts/spec/html.mjs` in markup-carve/carve at `d4c15e82`), run rather than
 * read.
 */
describe('a below-base fence run ends containers down to the owner its column selects', () => {
  it.each([
    [
      'depth 2, the run at column 0 reaches the document',
      "- a\n  - b\n\n    ```\n    p\n```\n\n    tail\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>p\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>\n    tail\n</code></pre>",
    ],
    [
      'depth 2, the run at column 1 is prose at the document',
      "- a\n  - b\n\n    ```\n    p\n ```\n\n    tail\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>p\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p><code></code></p>\n<p>tail</p>",
    ],
    [
      'depth 3, the run at column 0 ends all three items',
      "- a\n  - b\n    - c\n\n      ```\n      p\n```\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>c\n            <pre><code>p\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>\n</code></pre>",
    ],
    [
      'depth 3, the run at column 2 stops at the outer item',
      "- a\n  - b\n    - c\n\n      ```\n      p\n  ```\n\n      tail\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>c\n            <pre><code>p\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n    <pre><code>\n    tail\n</code></pre>\n  </li>\n</ul>",
    ],
    [
      'a tilde run degrades to prose at column 1',
      "- a\n  - b\n\n    ~~~\n    p\n ~~~\n\n    tail\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>p\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>~~~</p>\n<p>tail</p>",
    ],
    [
      'a raw fence ends the same way',
      "- a\n  - b\n\n    ```=html\n    <b>p</b>\n```\n\n    tail\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <b>p</b>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>\n    tail\n</code></pre>",
    ],
    [
      'an interrupting fence keeps its closer through the break',
      "- a\n  - b\n    ```\n    p\nx\n    ```\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>p\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>x\n<code></code></p>",
    ],
    [
      'the same one level deeper',
      "- a\n  - b\n    - c\n      ```\n      p\nx\n      ```\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>c\n            <pre><code>p\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>x\n<code></code></p>",
    ],
    [
      'a line below every column is not fence payload',
      "- outer\n  - head\n\n        ```\n        a\ntext\n",
      "<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>text</p>",
    ],
    [
      "the item's own block ends the descendant's fence, so the run folds into it",
      "- i0\n  - i1\n\n    ```\n    p\n\n  para\n```\n\n    tail\n",
      "<ul>\n  <li><p>i0</p>\n    <ul>\n      <li>i1\n        <pre><code>p\n\n</code></pre>\n      </li>\n    </ul>\n    <p>para\n<code></code></p>\n    <p>tail</p>\n  </li>\n</ul>",
    ],
    [
      'a sibling marker ends it the same way',
      "- i0\n  - i1\n\n    ```\n    p\n\n  - s\n```\n\n    tail\n",
      "<ul>\n  <li>i0\n    <ul>\n      <li><p>i1</p>\n        <pre><code>p\n\n</code></pre>\n      </li>\n      <li><p>s\n<code></code></p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: an over-indented descendant fence still closes at its holding column',
      "- a\n  - b\n      ```\n      p\n    ```\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>p\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: a closer at an intermediate item column is neither base nor container',
      "- a\n  - b\n    - c\n      ```\n      p\n    ```\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>c\n<code>\np\n</code></li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: a fence-shaped line inside a descendant comment payload opens nothing',
      "- a\n  - b\n    %%%\n\n    ```\n    p\n    %%%\n    q\nx\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        q\nx\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      "CONTROL: an ancestor's own paragraph below the child column ends the fence",
      "- a\n  - b\n\n    ```\n    p\n\n   para\nx\n",
      "<ul>\n  <li><p>a</p>\n    <ul>\n      <li>b\n        <pre><code>p\n\n</code></pre>\n      </li>\n    </ul>\n    <p>para\nx</p>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: a line at an intermediate column ends it at depth three',
      "- i0\n  - i1\n    - i2\n\n      ```\n      p\n\n    para\nx\n",
      "<ul>\n  <li>i0\n    <ul>\n      <li><p>i1</p>\n        <ul>\n          <li>i2\n            <pre><code>p\n\n</code></pre>\n          </li>\n        </ul>\n        <p>para\nx</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: a comment-shaped payload line does not stop the real closer',
      "- a\n  - b\n\n    ```\n    %%%\n    ```\n    %%%\n    q\nx\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>%%%\n</code></pre>\n        q\nx\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: the run at the outer item column closes nothing and stays there',
      "- a\n  - b\n\n    ```\n    p\n  ```\n\n    tail\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n        <pre><code>p\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\n  tail\n</code></pre>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: with no blank the run folds into the open paragraph',
      "- a\n  - b\n    ```\n    p\n```\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n<code>\np\n</code></li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: a closer inside a sibling item closes nothing',
      "- a\n  - b\n    ```\n    p\n  - c\n    ```\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b\n<code>\np</code></li>\n      <li>c\n<code></code></li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'CONTROL: a comment span is out by name',
      "- a\n  - b\n\n    %%%\n    p\n%%%\n\n    tail\n",
      "<ul>\n  <li>a\n    <ul>\n      <li><p>b</p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
  ])('%s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
