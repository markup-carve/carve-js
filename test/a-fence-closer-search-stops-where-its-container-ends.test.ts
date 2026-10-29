import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * §10 I4 opens a fence written after a paragraph only when a closer follows.
 * In a list item or a description body the search skips lines below the
 * container's column, and it ran to the end of the document, so it found a
 * closer in a later entry or past the point where the container had ended
 * (markup-carve/carve-js#1890). It now stops where the container does: at a
 * sibling or outer marker or the next entry, or at a line below the column
 * after a blank.
 *
 * Expected bytes are the executable reference's, identical at the 0.1.6 tag,
 * at this repo's spec pin and at spec main.
 *
 * markup-carve/carve#4018 removed the closer search: every row's fence now opens
 * and runs to the end of its container.
 */
describe('a fence closer search stops where its container ends', () => {
  const moved: [string, string, string][] = [
    [
      'an item whose closer is past a blank and a flush-left line',
      '- a\n  ```\n  b\n y\n\nz\n  ```\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y</p>\n<p>z</p>\n<pre><code></code></pre>',
    ],
    [
      'an ordered item whose closer is past a blank and a flush-left line',
      '1. a\n   ```\n   b\n  y\n\nz\n   ```\n',
      '<ol>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ol>\n<p>y</p>\n<p>z</p>\n<pre><code></code></pre>',
    ],
    [
      'a definition body whose closer is past a blank and a flush-left line',
      ':: t\n: a\n  ```\n  b\n y\n\nz\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <pre><code>b\n</code></pre>\n  </dd>\n</dl>\n<p>y</p>\n<p>z</p>\n<pre><code></code></pre>',
    ],
    [
      'a next definition before the closer',
      ':: t\n: a\n  ```\n  b\n y\n: c\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <pre><code>b\n</code></pre>\n  </dd>\n</dl>\n<p>y\n: c</p>\n<pre><code></code></pre>',
    ],
    [
      'a next term before the closer',
      ':: t\n: a\n  ```\n  b\n y\n:: u\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <pre><code>b\n</code></pre>\n  </dd>\n</dl>\n<p>y</p>\n<dl>\n  <dt>u</dt>\n</dl>\n<pre><code></code></pre>',
    ],
    [
      'a sibling marker before the closer',
      '- a\n  ```\n  b\n y\n- c\n  ```\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y\n- c</p>\n<pre><code></code></pre>',
    ],
  ]

  for (const [name, source, expected] of moved) {
    it(`does not reach past the container: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  // A closer inside the container still opens the fence, and no closer at all
  // still leaves it inline. These read the same whatever this search answers,
  // because the container's own parse decides them; they are here for the
  // shape. That the search still runs past a below-column line is pinned by
  // a-fence-opened-on-a-list-marker-line.test.ts and corpus 276-7.
  const unchanged: [string, string, string][] = [
    [
      'the closer inside the item',
      '- a\n  ```\n  b\n  ```\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>',
    ],
    [
      'the closer inside the definition body',
      ':: t\n: a\n  ```\n  b\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <pre><code>b\n</code></pre>\n  </dd>\n</dl>',
    ],
    [
      'no closer at all',
      '- a\n  ```\n  b\n y\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y</p>',
    ],
  ]

  for (const [name, source, expected] of unchanged) {
    it(`still reads: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  it('covers every row', () => {
    expect(moved).toHaveLength(6)
    expect(unchanged).toHaveLength(3)
  })
})
