import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `+` at a marker-line note's authored column attaches the next block to the
// note, including when the note began on an item's marker line (CARVE-P9-067).
const flat = (html: string): string => html.replace(/>\s+</g, '><')

describe('a plus below a marker-line note', () => {
  it.each([
    ['paragraph', '- [^a]: a\n  +\n  b\n\nr[^a]\n', '<p>b<a href="#fnref1"'],
    ['quote', '- [^a]: a\n  +\n  > r\n\nr[^a]\n', '<blockquote><p>r</p></blockquote>'],
    ['list', '- [^a]: a\n  +\n  - s\n\nr[^a]\n', '<ul><li>s</li></ul>'],
    ['fence', '- [^a]: a\n  +\n  ```\n  c\n  ```\n\nr[^a]\n', '<pre><code>c\n</code></pre>'],
    ['heading', '- [^a]: a\n  +\n  # h\n\nr[^a]\n', '<h1 id="h">h</h1>'],
    ['ordered item', '1. [^a]: a\n   +\n   b\n\nr[^a]\n', '<p>b<a href="#fnref1"'],
  ])('attaches the %s to the note', (_name, src, attached) => {
    const html = carveToHtml(src)
    expect(flat(html)).toContain('<li></li>')
    expect(flat(html)).toContain(flat(`<li id="fn1"><p>a</p>${attached}`))
  })

  it.each([
    ['at top level', '[^a]: a\n+\nb\n\nr[^a]\n'],
    ['on its own line in the item', '- x\n  [^a]: a\n  +\n  b\n\nr[^a]\n'],
    ['on a quoted item marker line', '- > [^a]: a\n  > +\n  > b\n\nr[^a]\n'],
  ])('still attaches to a note %s', (_name, src) => {
    expect(carveToHtml(src)).toContain('<p>a</p>\n      <p>b<a href="#fnref1"')
  })

  it('keeps the task marker line at its content coordinate', () => {
    const html = carveToHtml('- [ ] [^a]: a\n      +\n      b\n\nsee[^a]\n')
    expect(html).toContain('<p>a\n+\nb<a href="#fnref1"')
  })
})
