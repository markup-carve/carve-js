// markup-carve/carve#5021 (PART 0 S1, PART 9 §28, CARVE-P9-047): a comment line below a nested line block's column
// inside its open %%% span is span payload; the same document with the line at the block's column reads alike.
import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a comment line below a nested line block column inside its open %%% span', () => {
  it.each([
    ['a longer run at column 0 in a nested item (corpus 943-1)', '- - ::: |\n    %%%\n%%%%\n    %%%\nz\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <div class="line-block">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>z</p>'],
    ['a line comment at column 0 below an item with text (943-2)', '- x\n  - ::: |\n    %%%\n%% c\n    %%%\nz\n',
      '<ul>\n  <li>x\n    <ul>\n      <li>\n        <div class="line-block">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>z</p>'],
    ['verse before an unclosed span (943-5)', '- - ::: |\n    a\n    %%%\n%%%%\nz\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <div class="line-block">\n          <p>a<br>\nz</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>'],
    ['a description inside an item (943-6)', '- :: t\n  : ::: |\n    %%%\n%%%%\n    %%%\nz\n',
      '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <div class="line-block">\n\n        </div>\n      </dd>\n    </dl>\n  </li>\n</ul>\n<p>z</p>'],
    ['a longer run between the item columns, then verse (943-3)', '- - ::: |\n    %%%\n   %%%%\n    %%%\n    b\nz\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <div class="line-block">\n          <p>b<br>\nz</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>'],
    ['a longer run at the outer item column, then verse (943-4)', '- - ::: |\n    %%%\n  %%%%\n    %%%\n    b\nz\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <div class="line-block">\n          <p>b<br>\nz</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>'],
    ['verse before a span the outer column interrupts', '- - ::: |\n    a\n    %%%\n  %%%%\nz\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <div class="line-block">\n          <p>a<br>\nz</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>'],
    ['an exact run at column 0 closes the nested span', '- - ::: |\n    %%%\n%%%\n    %%%\n    b\nz\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <div class="line-block">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>z</p>'],
    ['a line comment below a description body', '- :: t\n  : ::: |\n    %%%\n  %% c\n    %%%\n    b\nz\n',
      '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <div class="line-block">\n          <p>b<br>\nz</p>\n        </div>\n      </dd>\n    </dl>\n  </li>\n</ul>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
