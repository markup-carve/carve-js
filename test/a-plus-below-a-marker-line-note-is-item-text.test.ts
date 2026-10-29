import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `+` below a marker-line note is the note's lazy text (carve#3885). A block
// that interrupts the paragraph opens in the item; a paragraph line folds on.
const flat = (html: string): string => html.replace(/>\s+</g, '><')
const note = (body: string): string =>
  `<li id="fn1"><p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>`

describe('a plus below a marker-line note', () => {
  it.each([
    ['paragraph', '- [^a]: a\n  +\n  b\n\nr[^a]\n', '<li></li>', 'a\n+\nb'],
    ['quote', '- [^a]: a\n  +\n  > r\n\nr[^a]\n', '<li><blockquote><p>r</p></blockquote></li>', 'a\n+'],
    ['list', '- [^a]: a\n  +\n  - s\n\nr[^a]\n', '<li><ul><li>s</li></ul></li>', 'a\n+'],
    ['fence', '- [^a]: a\n  +\n  ```\n  c\n  ```\n\nr[^a]\n', '<li><pre><code>c\n</code></pre></li>', 'a\n+'],
    ['heading', '- [^a]: a\n  +\n  # h\n\nr[^a]\n', '<li><h1 id="h">h</h1></li>', 'a\n+'],
    ['ordered item', '1. [^a]: a\n   +\n   b\n\nr[^a]\n', '<li></li>', 'a\n+\nb'],
  ])('is note text before a %s', (_name, src, item, body) => {
    const html = carveToHtml(src)
    expect(flat(html)).toContain(flat(item))
    expect(flat(html)).toContain(note(body))
  })

  it.each([
    ['at top level', '[^a]: a\n+\nb\n\nr[^a]\n'],
    ['on its own line in the item', '- x\n  [^a]: a\n  +\n  b\n\nr[^a]\n'],
    ['on a quoted item marker line', '- > [^a]: a\n  > +\n  > b\n\nr[^a]\n'],
  ])('still attaches to a note %s', (_name, src) => {
    expect(carveToHtml(src)).toContain('<p>a</p>\n      <p>b<a href="#fnref1"')
  })
})
