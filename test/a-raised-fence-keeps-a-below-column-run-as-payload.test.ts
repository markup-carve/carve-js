import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve-js#2243, two of the three families the ticket measures on a
// 576-case sweep of the raised-fence geometry. Every expectation below is the
// oracle's (`scripts/spec/layout.mjs` into `scripts/spec/html.mjs` in
// markup-carve/carve at 774eb404), run rather than read.
//
// FAMILY 1: a code fence opened at a CHILD item's content column, with its
// closing run written below the OUTER item's column. The outer item folds that
// run in as lazy text, so it is inside the child's fence and is payload
// (CARVE-P0-004). The child's collector ended the item there instead, the run
// leaked back out, and the unterminated fence it then opened reached the page as
// `<p><code></code></p>` - an element no input asked for.
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
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <pre><code>a\n```\n\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'family 1: a closer at column 0, trailing line at the child column',
      '- outer\n  - head\n\n    ```\n    a\n```\n\n    tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n```\n\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'family 1: a closer at column 0, trailing line past the child column',
      '- outer\n  - head\n\n    ```\n    a\n```\n\n      tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n```\n\n  tail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'family 1: a closer at column 1, trailing line at the outer column',
      '- outer\n  - head\n\n    ```\n    a\n ```\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head\n        <pre><code>a\n```\n\n</code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'family 1: a closer at column 1, trailing line at the child column',
      '- outer\n  - head\n\n    ```\n    a\n ```\n\n    tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n```\n\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'family 1: a closer at column 1, trailing line past the child column',
      '- outer\n  - head\n\n    ```\n    a\n ```\n\n      tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n```\n\n  tail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
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
  ])('control: %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
