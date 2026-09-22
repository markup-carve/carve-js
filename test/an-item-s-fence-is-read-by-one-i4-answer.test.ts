import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * §10 I4 lets a fence interrupt an open paragraph only when a closer follows,
 * and the search runs past a line below the container's column (CARVE-P0-014).
 * When it finds one, the open fenced body ends the container at that line
 * (CARVE-P0-013), so the container's own parse no longer holds the closer.
 * Asking I4 again there answered the other way: the item ended as though a
 * code block were open while the fence rendered as inline text
 * (markup-carve/carve-js#1880, markup-carve/carve#2141).
 *
 * The collector's answer is now the one the container's parse reads, and the
 * search stops where the container has ended, so it cannot find a closer that
 * belongs to a later item or entry. Expected bytes are the executable
 * reference's.
 */
describe("an item's fence is read by one I4 answer", () => {
  // Every row here was read two ways before, one answer for the container's
  // extent and the other for the fence.
  const moved: [string, string, string][] = [
    [
      'a bullet item',
      '- a\n  ```\n  b\n y\n  ```\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y\n<code></code></p>',
    ],
    [
      'after a figure caption',
      '- ![a](i)\n  ^ cap\n  ```\n  b\n y\n  ```\n',
      '<ul>\n  <li>\n    <figure>\n      <img src="i" alt="a">\n      <figcaption>cap</figcaption>\n    </figure>\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y\n<code></code></p>',
    ],
    [
      'after a quoted paragraph',
      '- > q\n  ```\n  b\n y\n  ```\n',
      '<ul>\n  <li>\n    <blockquote><p>q</p></blockquote>\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y\n<code></code></p>',
    ],
    [
      'an ordered item',
      '1. a\n   ```\n   b\n  y\n   ```\n',
      '<ol>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ol>\n<p>y\n<code></code></p>',
    ],
    [
      'a nested item',
      '- a\n  - n\n    ```\n    b\n   y\n    ```\n',
      '<ul>\n  <li>a\n    <ul>\n      <li>n\n        <pre><code>b\n</code></pre>\n      </li>\n    </ul>\n    y\n<code></code>\n  </li>\n</ul>',
    ],
    [
      'a tilde fence',
      '- a\n  ~~~\n  b\n y\n  ~~~\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y\n~~~</p>',
    ],
    [
      'a longer backtick run',
      '- a\n  ````\n  b\n y\n  ````\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y\n<code></code></p>',
    ],
    [
      'an item inside a quote',
      '> - a\n>   ```\n>   b\n>  y\n>   ```\n',
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>b\n</code></pre>\n    </li>\n  </ul>\n  <p>y\n<code></code></p>\n</blockquote>',
    ],
    [
      'a definition body',
      ':: t\n: a\n  ```\n  b\n y\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <pre><code>b\n</code></pre>\n  </dd>\n</dl>\n<p>y\n<code></code></p>',
    ],
    [
      'a definition body whose fence holds a colon run',
      ':: t\n: a\n  ```\n  :::\n y\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <pre><code>:::\n</code></pre>\n  </dd>\n</dl>\n<p>y\n<code></code></p>',
    ],
    [
      'an item whose closer is past a blank and a flush-left line',
      '- a\n  ```\n  b\n y\n\nz\n  ```\n',
      '<ul>\n  <li>a\n<code>\nb\ny</code></li>\n</ul>\n<p>z\n<code></code></p>',
    ],
    [
      'a definition body whose closer is past a blank and a flush-left line',
      ':: t\n: a\n  ```\n  b\n y\n\nz\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\n<code>\nb\ny</code></dd>\n</dl>\n<p>z\n<code></code></p>',
    ],
  ]

  for (const [name, source, expected] of moved) {
    it(`reads the fence once: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  // Rows that read the same before and after. The first two are where the
  // search has to stop: past them, a closer belongs to another item or entry.
  const unchanged: [string, string, string][] = [
    [
      'a sibling marker before the closer',
      '- a\n  ```\n  b\n- c\n  ```\n',
      '<ul>\n  <li>a\n<code>\nb</code></li>\n  <li>c\n<code></code></li>\n</ul>',
    ],
    [
      'a next entry before the closer',
      ':: t\n: a\n  ```\n  b\n y\n: c\n  ```\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\n<code>\nb\ny</code></dd>\n  <dd>c\n<code></code></dd>\n</dl>',
    ],
    // The item's own parse finds this closer whatever the collector says, so
    // no mutation of the change reaches it; it is here for the shape.
    [
      'the closer inside the item',
      '- a\n  ```\n  b\n  ```\n',
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>',
    ],
    [
      'no closer at all',
      '- a\n  ```\n  b\n y\n',
      '<ul>\n  <li>a\n<code>\nb\ny</code></li>\n</ul>',
    ],
    [
      'a flush-left closer in an item',
      '- a\n  ```\n  b\n y\n```\n',
      '<ul>\n  <li>a\n<code>\nb\ny\n</code></li>\n</ul>',
    ],
  ]

  for (const [name, source, expected] of unchanged) {
    it(`still reads: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  it('covers every row', () => {
    expect(moved).toHaveLength(12)
    expect(unchanged).toHaveLength(5)
  })
})
