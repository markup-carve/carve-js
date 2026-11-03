import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The walk reads a task item's lines from its box's column, so a term on the marker line is measured without the box.
const tight = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each([
  ['- [ ] > :: t\n      > : a\n',
    '<ul class="task-list"><li><input type="checkbox" disabled><blockquote><dl><dt>t</dt><dd>a</dd></dl></blockquote></li></ul>'],
  ['- [ ] > :: t\n      > : a\n      : x\n',
    '<ul class="task-list"><li><input type="checkbox" disabled><blockquote><dl><dt>t</dt><dd>a\n: x</dd></dl></blockquote></li></ul>'],
  ['- [x] > :: t\n  > : a\n',
    '<ul class="task-list"><li data-task-state="x"><input type="checkbox" checked disabled><blockquote><dl><dt>t</dt><dd>a</dd></dl></blockquote></li></ul>'],
  ['- [ ] > :: t\n      > :: u\n      > : a\n',
    '<ul class="task-list"><li><input type="checkbox" disabled><blockquote><dl><dt>t</dt><dt>u</dt><dd>a</dd></dl></blockquote></li></ul>'],
  ['> - [ ] > :: t\n>       > : a\n',
    '<blockquote><ul class="task-list"><li><input type="checkbox" disabled><blockquote><dl><dt>t</dt><dd>a</dd></dl></blockquote></li></ul></blockquote>'],
  ['- [ ] > - :: t\n      >   : a\n',
    '<ul class="task-list"><li><input type="checkbox" disabled><blockquote><ul><li><dl><dt>t</dt><dd>a</dd></dl></li></ul></blockquote></li></ul>'],
  ['- [ ] > 1. :: t\n      >    : a\n',
    '<ul class="task-list"><li><input type="checkbox" disabled><blockquote><ol><li><dl><dt>t</dt><dd>a</dd></dl></li></ol></blockquote></li></ul>'],
  ['- [ ] - > :: t\n        > : a\n',
    '<ul class="task-list"><li><input type="checkbox" disabled><ul><li><blockquote><dl><dt>t</dt><dd>a</dd></dl></blockquote></li></ul></li></ul>'],
  ['- [ ] - [ ] > :: t\n          > : a\n',
    '<ul class="task-list"><li><input type="checkbox" disabled><ul class="task-list"><li><input type="checkbox" disabled><blockquote><dl><dt>t</dt><dd>a</dd></dl></blockquote></li></ul></li></ul>'],
])('a task-hosted quote reads its entries past the box: %j', (source, html) => {
  expect(tight(carveToHtml(source))).toBe(html)
})
