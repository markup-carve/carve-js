import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

// markup-carve/carve-js#4300: an HTML block a quoted item's marker line opens is
// a block when the item goes on after it (markup-carve/carve#4932), and a quote
// run entered inside an item reads its fences and HTML blocks at the item's
// column. Expected HTML is what commonmark.js 0.31 gives for the source.
describe('a quoted Markdown item holds an HTML block that ends before it', () => {
  const cases: Array<[string, string, string, string]> = [
    [
      'ticket reproduction: the block ends on the marker line',
      '> - <!DOCTYPE html>\n>   *a*\n',
      '> - ```=html\n>   <!DOCTYPE html>\n>   ```\n>   /a/\n',
      '<blockquote>\n  <ul>\n    <li>\n      <!DOCTYPE html>\n      <em>a</em>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'loose list',
      '> - a\n>   b\n>\n> - <!DOCTYPE html>\n>     *a*\n',
      '> - a\n>   b\n>\n> - ```=html\n>   <!DOCTYPE html>\n>   ```\n>\n>   /a/\n',
      '<blockquote>\n  <ul>\n    <li><p>a\nb</p></li>\n    <li>\n      <!DOCTYPE html>\n      <p><em>a</em></p>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'item in a quote an item holds, then a line that leaves it',
      '- > - <span>\n  >   x\n  > x\n',
      '- > - ```=html\n  >   <span>\n  >   x\n  >   ```\n  >\n  > x\n',
      '<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>\n          <span>\nx\n        </li>\n      </ul>\n      <p>x</p>\n    </blockquote>\n  </li>\n</ul>',
    ],
    [
      'marker indented in the quote moves with the list',
      '>  - <!DOCTYPE html>\n>    *a*\n',
      '> - ```=html\n>   <!DOCTYPE html>\n>   ```\n>   /a/\n',
      '<blockquote>\n  <ul>\n    <li>\n      <!DOCTYPE html>\n      <em>a</em>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'a fence under the block stays in the item',
      '> - <!DOCTYPE html>\n>   ```\n>   x\n>   ```\n',
      '> - ```=html\n>   <!DOCTYPE html>\n>   ```\n>   ```\n>   x\n>   ```\n',
      '<blockquote>\n  <ul>\n    <li>\n      <!DOCTYPE html>\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'an HTML block in a quoted item ends at a line left of the item',
      '> - a\n>   </div>\n> q\n',
      '> - a\n>   ```=html\n>   </div>\n>   ```\n>\n> q\n',
      '<blockquote>\n  <ul>\n    <li>a\n      </div>\n    </li>\n  </ul>\n  <p>q</p>\n</blockquote>',
    ],
    [
      'an HTML block start within three columns of the item',
      '> - a\n>     </div>\n> q\n',
      '> - a\n>   ```=html\n>   </div>\n>   ```\n>\n> q\n',
      '<blockquote>\n  <ul>\n    <li>a\n      </div>\n    </li>\n  </ul>\n  <p>q</p>\n</blockquote>',
    ],
    [
      'a fence within three columns of the item, after a blank',
      '> - a\n>\n>     ```\n>   z\nafter\n',
      '> {loose}\n> - a\n>\n>   ```\n>   z\n>   ```\n\nafter\n',
      '<blockquote>\n  <ul>\n    <li><p>a</p>\n      <pre><code>z\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>after</p>',
    ],
    [
      'a fence after a blank in an item whose marker moves',
      '>  - a\n>\n>    ```\n>    x\n>    ```\n',
      '> {loose}\n> - a\n>\n>   ```\n>   x\n>   ```\n',
      '<blockquote>\n  <ul>\n    <li><p>a</p>\n      <pre><code>x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'a fence past the item column strips its own indent from the body',
      '> - a\n>     ```\n>      x\n>     ```\n',
      '> - a\n>   ```\n>    x\n>   ```\n',
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code> x\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
    ],
  ]
  it.each(cases)('%s', (_name, markdown, carve, html) => {
    const written = markdownToCarve(markdown)
    expect(written).toBe(carve)
    expect(carveToCarve(written)).toBe(written)
    expect(carveToHtml(written)).toBe(html)
  })
})
