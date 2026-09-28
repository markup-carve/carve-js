import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve-js#2243, family 3: a `%%%` span a DESCENDANT holds, and the
// two readings its host got wrong. Every expectation is the oracle's
// (`scripts/spec/layout.mjs` into `scripts/spec/html.mjs` in markup-carve/carve
// at 3f97ff58), run rather than read.
//
// THE TRAILING LINE'S ITEM. PART 9 §53 gives the fence form the body and closer
// that travel with its OPENER, so a span opened at a container's content column
// is a block of that container and its paragraph is over. Reading the CLOSER's
// column too kept the paragraph claim alive, and a line below the child's column
// then folded into the child - authored text one item deeper than it was written.
// markup-carve/carve#2527 settled the same question for the oracle's collector.
//
// THE HOST'S TIGHTNESS. §17 L1 loosens an item on a second PARAGRAPH, so the
// scan looks past an invisible block to find one. Looking past one the CHILD
// holds walked out of the child, and the blank in front of it was credited to
// the host.
//
// The band between two ancestors' content columns is NOT fixed here and has no
// row below: a closer written there still reaches the host's rebase as a run of
// its own. That is the residue this family leaves.

describe('a comment span a descendant holds', () => {
  it.each([
    [
      'the trailing line at the outer column stays out of the child',
      '- outer\n  - head\n    %%%\n    a\n%%%\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ul>',
    ],
    [
      'two levels in, the trailing line lands in the item whose column it reaches',
      '- a\n  - outer\n    - head\n      %%%\n      a\n%%%\n    tail\n',
      '<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'an ordered host reads the same',
      '1. outer\n   - head\n     %%%\n     a\n%%%\n   tail\n',
      '<ol>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ol>',
    ],
    [
      'an ordered child reads the same',
      '- outer\n  1. head\n     %%%\n     a\n%%%\n  tail\n',
      '<ul>\n  <li>outer\n    <ol>\n      <li>head</li>\n    </ol>\n    tail\n  </li>\n</ul>',
    ],
    [
      'a wider fence reads the same',
      '- outer\n  - head\n    %%%%\n    a\n%%%%\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ul>',
    ],
    [
      'a closer at the child\'s own column reads the same',
      '- outer\n  - head\n    %%%\n    a\n    %%%\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ul>',
    ],
    [
      'a blank before a span the child holds leaves the outer item tight',
      '- outer\n  - head\n\n    %%%\n    a\n%%%\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ul>',
    ],
    [
      'the same blank before a LINE comment the child holds',
      '- outer\n  - head\n\n    %% a\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ul>',
    ],
    [
      'two levels in, a blank before a span the grandchild holds',
      '- a\n  - outer\n    - head\n\n      %%%\n      a\n%%%\n    tail\n',
      '<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'control: a blank before a VISIBLE block the child holds',
      '- outer\n  - head\n\n    ```\n    a\n    ```\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    tail\n  </li>\n</ul>',
    ],
    [
      'control: a span the OUTER item holds ends its paragraph',
      '- outer\n\n  %%%\n  a\n%%%\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'control: a second paragraph after the span still loosens',
      '- outer\n  - head\n\n    %%%\n    a\n%%%\n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <ul>\n      <li>head</li>\n    </ul>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'control: a comment of the item\'s own does not hide a second paragraph',
      '- outer\n\n  %% n\n  tail\n',
      '<ul>\n  <li><p>outer</p>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'control: a blank inside the child\'s sub-list keeps the outer tight',
      '- outer\n  - head\n\n    more\n  tail\n',
      '<ul>\n  <li>outer\n    <ul>\n      <li><p>head</p>\n        <p>more\ntail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
    ],
  ])('%s', (_name, src, html) => {
    expect(carveToHtml(src)).toBe(html)
  })
})
