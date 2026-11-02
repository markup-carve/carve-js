import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()
const task = (inner: string, after = '') =>
  `<ul class="task-list"><li><input type="checkbox" disabled><ul><li>${inner}</li></ul>${after}</li></ul>`

// The shift below a marker-line sub-item is measured from the box column, whatever the marker gap (carve-js#4257).
it.each([
  ['-  [ ] - # h\n         c\n', task('<h1 id="h">h</h1>c')],
  ['-   [ ] - # h\n          c\n', task('<h1 id="h">h</h1>c')],
  ['- [ ] - # h\n        c\n', task('<h1 id="h">h</h1>c')],
  ['-  [ ] - [^f]: :: t\n          c\n', task('c')],
  ['-  [ ] - # h\n        c\n', task('<h1 id="h">h</h1>', 'c')],
])('reads %j', (source, html) => {
  expect(normalize(carveToHtml(source))).toBe(normalize(html))
})
