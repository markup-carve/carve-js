import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `%%%` span opened on a CHILD's marker line (`- - %%%`): the first exact-width
// line closes it at any column (CARVE-P0-005, PART 0 S1), so it ends neither item.
// Expectations are the spec model's (markup-carve/carve#4116).
describe('a comment span opened on a child marker line', () => {
  it.each([
    [
      'the column-0 closer closes the span before a later run',
      '. - %%%\n%%%\nx\n%%%\n',
      '<ol>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ol>\n<p>x</p>',
    ],
    [
      'a bullet parent reads the same',
      '- - %%%\n%%%\nx\n%%%\n',
      '<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>',
    ],
    [
      'payload at the child column stays hidden',
      '- - %%%\n    y\n%%%\nx\n%%%\n',
      '<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>',
    ],
    [
      'a third level closes at column 0 too',
      '- - - %%%\n%%%\nx\n%%%\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>',
    ],
    [
      'inside a quote',
      '> - - %%%\n> %%%\n> x\n> %%%\n',
      '<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li></li>\n      </ul>\n    </li>\n  </ul>\n  <p>x</p>\n</blockquote>',
    ],
    [
      'a fence the outer item opens after the child ends keeps its own lines',
      '1. - %%%\n    ```\n    z\n%%%\nx\n',
      '<ol>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n    <pre><code>z\n</code></pre>\n  </li>\n</ol>\n<p>x</p>',
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
