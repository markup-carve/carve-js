import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve-js#2243, two of the three families the ticket measures on a
// 576-case sweep of the raised-fence geometry. Every expectation below is the
// oracle's (`scripts/spec/layout.mjs` into `scripts/spec/html.mjs` in
// markup-carve/carve at 774eb404), run rather than read.
//
// FAMILY 1: a code fence opened at a CHILD item's content column, with its
// closing run written below the OUTER item's column.
//
// RE-MEASURED at markup-carve/carve `d4c15e82` after markup-carve/carve#2490
// ruled the run's OWNER by column (corpus category 509, carve-js#2261). The run
// closes nothing, but it ends every container between the fence's host and the
// ancestor its column reaches, and it is classified in that survivor. These six
// rows recorded the pre-ruling answer, where the run stayed the child's payload.
//
// FAMILY 2: a colon fence over-indented by ONE column, with its closer written
// in the band between column 0 and the outer item's content column. A line the
// container took from below its own column carries alignment, not an authored
// column, and at an over-indent of one that residue is exactly one column - the
// same one the rebased opener carries - so the group closed on a run the
// container never placed at its base.

describe('a raised fence keeps a below-column run as payload', () => {
  it.each([
    [
      'family 1: a closer at column 0, trailing line at the outer column',
      '- outer\n  - head\n\n    ```\n    a\n```\n\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>\n  tail\n</code></pre>',
    ],
    [
      'family 1: a closer at column 0, trailing line at the child column',
      '- outer\n  - head\n\n    ```\n    a\n```\n\n    tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>\n    tail\n</code></pre>',
    ],
    [
      'family 1: a closer at column 0, trailing line past the child column',
      '- outer\n  - head\n\n    ```\n    a\n```\n\n      tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<pre><code>\n      tail\n</code></pre>',
    ],
    [
      'family 1: a closer at column 1, trailing line at the outer column',
      '- outer\n  - head\n\n    ```\n    a\n ```\n\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p><code></code></p>\n<p>tail</p>',
    ],
    [
      'family 1: a closer at column 1, trailing line at the child column',
      '- outer\n  - head\n\n    ```\n    a\n ```\n\n    tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p><code></code></p>\n<p>tail</p>',
    ],
    [
      'family 1: a closer at column 1, trailing line past the child column',
      '- outer\n  - head\n\n    ```\n    a\n ```\n\n      tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p><code></code></p>\n<p>tail</p>',
    ],
    [
      'family 2: a band closer at an over-indent of one, blank before',
      '- outer\n  - head\n\n     :::\n     a\n :::\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <div>\n          <p>a\n:::</p>\n        </div>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'family 2: a band closer at an over-indent of one, no blank before',
      '- outer\n  - head\n     :::\n     a\n :::\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <div>\n          <p>a\n:::</p>\n        </div>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'family 2: the trailing line at the child column joins the div',
      '- outer\n  - head\n\n     :::\n     a\n :::\n\n    tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <div>\n          <p>a\n:::</p>\n          <p>tail</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'family 2: the trailing line past the child column joins the div',
      '- outer\n  - head\n\n     :::\n     a\n :::\n\n      tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <div>\n          <p>a\n:::</p>\n          <p>tail</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
  ])('%s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // CONTROLS. Each of these already agreed with the oracle, and each is what a
  // fix reaching one column too far would break: a closer that really does close
  // at or above the outer column, a fence that closes inside its own child, a
  // run that folds into the paragraph because nothing closes it, the same band
  // closer at no over-indent, a colon closer at its own base, and one at column
  // zero that ends the container outright.
  it.each([
    [
      'a code closer at the outer column still closes',
      '- outer\n  - head\n\n    ```\n    a\n  ```\n\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>',
    ],
    [
      'a code closer at the child column still closes',
      '- outer\n  - head\n    ```\n    a\n    ```\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'with no blank the run is still the paragraph inline verbatim',
      '- outer\n  - head\n    ```\n    a\n```\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n<code>\na\n</code></li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'a band closer at no over-indent is payload already',
      '- outer\n  - head\n\n    :::\n    a\n :::\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <div>\n          <p>a\n:::</p>\n        </div>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'a colon closer at the fence base still closes',
      '- outer\n  - head\n\n     :::\n     a\n     :::\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <div>\n          <p>a</p>\n        </div>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'a colon closer at column zero still closes',
      '- outer\n  - head\n\n     :::\n     a\n:::\n\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <div>\n          <p>a</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>\n<div>\n  <p>tail</p>\n</div>',
    ],
    // A FENCE BODY REACHED THE COLUMN. The first version of the family 2 guard
    // read the authored-base eligibility set, which also excludes a line
    // collected while a code fence was open - so a raised colon container's
    // nested code block kept a column of indent in its payload and read its own
    // closer as content. The guard names the folded lines instead.
    [
      'a raised colon container rebases its nested code block',
      '- item\n\n   :::\n\n   ```\n   a\n   ```\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <pre><code>a\n</code></pre>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'the same container with no blank before the fence',
      '- item\n\n   :::\n   ```\n   a\n   ```\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <pre><code>a\n</code></pre>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'the same container one column deeper',
      '- item\n\n    :::\n\n    ```\n    a\n    ```\n    :::\n',
      '<ul>\n  <li>item\n    <div>\n      <pre><code>a\n</code></pre>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'a raised colon container rebases a nested comment fence',
      '- item\n\n   :::\n\n   %%%\n   a\n   %%%\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n\n    </div>\n  </li>\n</ul>',
    ],
    // THE HOLD REACHES EVERY FOLDED LINE, NOT ONLY A COLON RUN. A heading, a
    // thematic break or a quote written in the band is text where the host folded
    // it, and moving it onto the group's base made it a block.
    [
      'a folded heading stays text',
      '- item\n\n   :::\n   a\n # heading\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a\n# heading</p>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'a folded thematic break stays text',
      '- item\n\n   :::\n   a\n ---\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a\n\u2014</p>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'a folded quote marker stays text',
      '- item\n\n   :::\n   a\n > q\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a\n&gt; q</p>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'a heading that reached the column is still a block',
      '- item\n\n    :::\n    a\n  # heading\n    :::\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a</p>\n      <h1 id="heading">heading</h1>\n    </div>\n  </li>\n</ul>',
    ],
    // AND IT STOPS AT AN OPAQUE PAYLOAD. A comment fence's own closing run can be
    // written in the band, and holding it there left the payload open with the
    // container's closer inside it.
    [
      'a comment closer in the band still ends its payload',
      '- item\n\n   :::\n\n   %%%\n   a\n  %%%\n   :::\n\n  tail\n',
      '<ul>\n  <li><p>item</p>\n    <div>\n\n    </div>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'a flush comment closer ends it too, and the band run after it is text',
      '- item\n\n   :::\n\n   %%%\n   a\n%%%\n :::\n\n  tail\n',
      '<ul>\n  <li>item\n    <div>\n      <p>:::</p>\n      <p>tail</p>\n    </div>\n  </li>\n</ul>',
    ],
    // AN UNTERMINATED FENCE OPENS NO PAYLOAD, so the hold still reaches a folded
    // line below it. The first attempt at the opaque arm marked everything after
    // any fence-shaped line as payload, which handed the folded heading back to
    // the dedent.
    [
      'a degraded comment fence leaves the folded heading as text',
      '- item\n\n   :::\n   a\n   %%%\n   b\n # heading\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a</p>\n      <p>b\n# heading</p>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'a degraded tilde fence leaves it as text too',
      '- item\n\n   :::\n   a\n   ~~~\n   b\n # heading\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a\n~~~\nb\n# heading</p>\n    </div>\n  </li>\n</ul>',
    ],
    [
      'a terminated comment fence still leaves it as text',
      '- item\n\n   :::\n   a\n   %%%\n   b\n   %%%\n # heading\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a</p>\n      <p># heading</p>\n    </div>\n  </li>\n</ul>',
    ],
    // A VERBATIM CLOSER RE-BASES AND A COMMENT ONE DOES NOT, so a folded run is
    // the comment fence's closer and never the code fence's. Reading it as one
    // turned the paragraph's inline verbatim run into a block.
    [
      'a folded code run is not a closer at column zero',
      '- item\n\n   :::\n   a\n   ```\n   b\n```\n   :::\n\n  tail\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a\n<code>\nb\n</code></p>\n    </div>\n    tail\n  </li>\n</ul>',
    ],
    [
      'nor in the band',
      '- item\n\n   :::\n   a\n   ```\n   b\n ```\n   :::\n\n  tail\n',
      '<ul>\n  <li>item\n    <div>\n      <p>a\n<code>\nb\n</code></p>\n    </div>\n    tail\n  </li>\n</ul>',
    ],
    // A closer that REACHED the container's column is not folded, and it still
    // closes from there. The lookahead accepts the group's own base and the
    // container's column, the pair the verbatim arm above already accepts.
    [
      'a closer at the container column still closes the payload',
      '- item\n\n   :::\n   ```\n   x\n  ```\n   :::\n',
      '<ul>\n  <li>item\n    <div>\n      <pre><code>x\n</code></pre>\n    </div>\n  </li>\n</ul>',
    ],
  ])('control: %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
