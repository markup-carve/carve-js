import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A note opened on an unquoted item's marker line owns no `+`. One at the
// item's content column is item text, and its follower stays in the item.
const note = (body: string): string =>
  `<li id="fn1">\n      ${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>`

describe('a plus below a marker-line note', () => {
  it.each([
    ['paragraph', '- [^a]: a\n  +\n  b\n\nr[^a]\n', '<li>+\nb</li>'],
    ['quote', '- [^a]: a\n  +\n  > r\n\nr[^a]\n', '<li>+\n    <blockquote><p>r</p></blockquote>'],
    ['list', '- [^a]: a\n  +\n  - s\n\nr[^a]\n', '<li>+\n    <ul>\n      <li>s</li>'],
    ['fence', '- [^a]: a\n  +\n  ```\n  c\n  ```\n\nr[^a]\n', '<li>+\n    <pre><code>c\n</code></pre>'],
    ['heading', '- [^a]: a\n  +\n  # h\n\nr[^a]\n', '<li>+\n    <h1 id="h">h</h1>'],
    ['ordered item', '1. [^a]: a\n   +\n   b\n\nr[^a]\n', '<li>+\nb</li>'],
  ])('is item text before a %s', (_name, src, item) => {
    const html = carveToHtml(src)
    expect(html).toContain(item)
    expect(html).toContain(note('<p>a'))
  })

  it.each([
    ['at top level', '[^a]: a\n+\nb\n\nr[^a]\n'],
    ['on its own line in the item', '- x\n  [^a]: a\n  +\n  b\n\nr[^a]\n'],
    ['on a quoted item marker line', '- > [^a]: a\n  > +\n  > b\n\nr[^a]\n'],
  ])('still attaches to a note %s', (_name, src) => {
    expect(carveToHtml(src)).toContain('<p>a</p>\n      <p>b<a href="#fnref1"')
  })
})
