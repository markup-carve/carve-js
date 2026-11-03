import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A quote stacked on a marker line with a first-block `+` takes its follower;
// a quoted line right after it continues that quote instead of opening another.
const html = (src: string): string => carveToHtml(src).replace(/>\s+</g, '><').trim()

describe('a stacked quote plus reads on at its quoted line', () => {
  it.each([
    ['description-shaped follower', '- > +\n  : x\n  > q\n',
      '<ul><li><blockquote><p>: x</p><p>q</p></blockquote></li></ul>'],
    ['list follower', '- > +\n  - x\n  > q\n',
      '<ul><li><blockquote><ul><li>x</li></ul><p>q</p></blockquote></li></ul>'],
    ['fenced follower', '- > +\n  ``` js\n  x\n  ```\n  > q\n',
      '<ul><li><blockquote><pre><code class="language-js">x\n</code></pre><p>q</p></blockquote></li></ul>'],
    ['ordered item before a sibling', '1. > +\n   x\n   > q\n2. b\n',
      '<ol><li><blockquote><p>x</p><p>q</p></blockquote></li><li>b</li></ol>'],
    ['nested stack', '- - > +\n    x\n    > q\n',
      '<ul><li><ul><li><blockquote><p>x</p><p>q</p></blockquote></li></ul></li></ul>'],
    ['list inside a quote', '> - > +\n>   x\n>   > q\n',
      '<blockquote><ul><li><blockquote><p>x</p><p>q</p></blockquote></li></ul></blockquote>'],
    ['lazy line after the quoted line', '- > +\n  x\n  > q\n  r\n',
      '<ul><li><blockquote><p>x</p><p>q\nr</p></blockquote></li></ul>'],
  ])('%s', (_name, src, expected) => {
    expect(html(src)).toBe(expected)
  })

  it('leaves a quoted line after a blank to its own quote', () => {
    expect(html('- > +\n  x\n\n  > q\n')).toBe(
      '<ul><li><blockquote><p>x</p></blockquote><blockquote><p>q</p></blockquote></li></ul>')
  })
})
