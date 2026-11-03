import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A first-block item stacked behind list markers, a task box or a quote host
// measures the lines after its attached block from its own content column.
const html = (src: string): string => carveToHtml(src).replace(/>\s+</g, '><').trim()

describe('a stacked first-block item measures later lines in its own frame', () => {
  it.each([
    ['task item quoted line', '- [ ] > +\n      x\n      > q\n',
      '<ul class="task-list"><li><input type="checkbox" disabled><blockquote><p>x</p><p>q</p></blockquote></li></ul>'],
    ['task item quoted line below the follower', '- [x] > +\n      x\n    > q\n',
      '<ul class="task-list"><li data-task-state="x"><input type="checkbox" checked disabled><blockquote><p>x</p><p>q</p></blockquote></li></ul>'],
    ['task item block after a blank', '- [ ] > +\n      x\n\n     y\n',
      '<ul class="task-list"><li><input type="checkbox" disabled><blockquote><p>x</p></blockquote><p>y</p></li></ul>'],
    ['nested stack quoted line after a blank', '- - > +\n    x\n\n    > q\n',
      '<ul><li><ul><li><blockquote><p>x</p></blockquote><blockquote><p>q</p></blockquote></li></ul></li></ul>'],
    ['nested stack paragraph after a blank', '- - > +\n    x\n\n    y\n',
      '<ul><li><ul><li><blockquote><p>x</p></blockquote><p>y</p></li></ul></li></ul>'],
    ['nested stack outer paragraph after a blank', '- - > +\n    x\n\n  y\n',
      '<ul><li><ul><li><blockquote><p>x</p></blockquote></li></ul><p>y</p></li></ul>'],
    ['three-deep stack, middle item block', '- - - > +\n      x\n\n     y\n',
      '<ul><li><ul><li><ul><li><blockquote><p>x</p></blockquote></li></ul><p>y</p></li></ul></li></ul>'],
    ['sibling marker one column short', '- - > +\n    x\n\n   - s\n',
      '<ul><li><ul><li><blockquote><p>x</p></blockquote></li><li><p>s</p></li></ul></li></ul>'],
    ['task-nested sibling marker', '- [ ] - > +\n        x\n\n       - s\n',
      '<ul class="task-list"><li><input type="checkbox" disabled><ul><li><blockquote><p>x</p></blockquote></li><li><p>s</p></li></ul></li></ul>'],
    ['list inside a quote, paragraph after a blank', '> - > +\n>   x\n>\n>   y\n',
      '<blockquote><ul><li><blockquote><p>x</p></blockquote><p>y</p></li></ul></blockquote>'],
    ['nested list inside a quote', '> - - > +\n>     x\n>\n>     y\n',
      '<blockquote><ul><li><ul><li><blockquote><p>x</p></blockquote><p>y</p></li></ul></li></ul></blockquote>'],
  ])('%s', (_name, src, expected) => {
    expect(html(src)).toBe(expected)
  })
})
