import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// Stacked openers on one line keep the innermost owner (CARVE-P9-067, markup-carve/carve-js#3454).
describe('a stacked quote plus opened on its own line in a host', () => {
  const cases: Array<[string, string]> = [
    ['- a\n  > > +\n  q\n', '<ul><li>a<blockquote><blockquote><p>q</p></blockquote></blockquote></li></ul>'],
    ['- a\n  > > +\n  | c |\n', '<ul><li>a<blockquote><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></blockquote></li></ul>'],
    ['- a\n  > > +\n  ```\n  code\n  ```\n', '<ul><li>a<blockquote><blockquote><pre><code>code</code></pre></blockquote></blockquote></li></ul>'],
    ['- a\n  > > +\n  > q\n', '<ul><li>a<blockquote><blockquote><p>q</p></blockquote></blockquote></li></ul>'],
    ['1. a\n   > > +\n   q\n', '<ol><li>a<blockquote><blockquote><p>q</p></blockquote></blockquote></li></ol>'],
    ['- a\n  - b\n    > > +\n    q\n', '<ul><li>a<ul><li>b<blockquote><blockquote><p>q</p></blockquote></blockquote></li></ul></li></ul>'],
    [':: t\n: d\n  > > +\n  q\n', '<dl><dt>t</dt><dd><p>d</p><blockquote><blockquote><p>q</p></blockquote></blockquote></dd></dl>'],
    ['- a\n  > > > +\n  q\n', '<ul><li>a<blockquote><blockquote><blockquote><p>q</p></blockquote></blockquote></blockquote></li></ul>'],
  ]
  for (const [source, html] of cases) {
    it(`attaches the follower of ${JSON.stringify(source)} to the innermost quote`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }
})
