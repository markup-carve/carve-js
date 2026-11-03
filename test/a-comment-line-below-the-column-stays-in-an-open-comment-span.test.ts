// markup-carve/carve#4994 (PART 0 S1, PART 9 §28): a comment line below an item's column inside an open %%% span.
import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a comment line below the column inside an open %%% span', () => {
  it.each([
    ['a closer below the column, a blank and a new span', '- ::: |\n  %%%\n %%%\n\n  %%%\nz\n',
      '<ul>\n  <li>\n    <div class="line-block">\n\n    </div>\n  </li>\n</ul>\n<p>z</p>'],
    ['a longer run at column 0, then a fence below the column', '- ::: |\n  %%%\n%%%%\n ```\n  %%%\nz\n',
      '<ul>\n  <li>\n    <div class="line-block">\n\n    </div>\n  </li>\n</ul>\n<pre><code> %%%\nz\n</code></pre>'],
    ['a longer run below a numbered item, then a sibling list', '1. ::: |\n   %%%\n  %%%%\n - b\n   %%%\nz\n',
      '<ol>\n  <li>\n    <div class="line-block">\n\n    </div>\n  </li>\n</ol>\n<ul>\n  <li>b</li>\n</ul>\n<p>z</p>'],
    ['the item continues after the closer', '- ::: |\n  %%%\n %%%\n  q\n  :::\nz\n',
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>q</p>\n    </div>\n  </li>\n</ul>\n<p>z</p>'],
    ['a comment line below the column is payload', '- ::: |\n  %%%\n%% c\n  :::\n  q\nz\n',
      '<ul>\n  <li>\n    <div class="line-block">\n\n    </div>\n  </li>\n</ul>\n<p>z</p>'],
    ['the stanza takes a lazy line after the span', '- ::: |\n  x\n  %%%\n%% c\n %%%\nz\n',
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>x<br>\nz</p>\n    </div>\n  </li>\n</ul>'],
    ['a blank before the closer is payload', '- ::: |\n  %%%\n  %%%%\n\n %%%\nz\n',
      '<ul>\n  <li>\n    <div class="line-block">\n\n    </div>\n  </li>\n</ul>\n<p>z</p>'],
    ['a longer run after a blank in the item span', '- a\n  %%%\n\n %%%%\nz\n',
      '<ul>\n  <li>a</li>\n</ul>\n<p>z</p>'],
    ['the item span keeps a longer run below the column', '- a\n  %%%\n%%%%\n ```\n\nz\n',
      '<ul>\n  <li>a</li>\n</ul>\n<pre><code>\nz\n</code></pre>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
