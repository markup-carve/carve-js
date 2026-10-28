import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A footnote can take a lazy line while its paragraph remains open.
const html = (source: string): string => carveToHtml(source).replace(/\s+/g, ' ').replace(/> </g, '><').trim()

const quotedList = '<blockquote><ul><li>para</li></ul></blockquote>'

it.each([
  ['> - para\n>   [^f]: n\ntail\n', `${quotedList}<p>tail</p>`],
  ['> 1. para\n>    [^f]: n\ntail\n', '<blockquote><ol><li>para</li></ol></blockquote><p>tail</p>'],
  ['> > - para\n> >   [^f]: n\ntail\n', '<blockquote><blockquote><ul><li>para</li></ul></blockquote></blockquote><p>tail</p>'],
  ['> - para\n>   [^f]: n\n```\ncode\n', `${quotedList}<pre><code>code </code></pre>`],
  ['> - para\n>   [^f]: n\n>     more\ntail\n', `${quotedList}<p>tail</p>`],
  ['> :: t\n> : d\n>   [^f]: n\ntail\n', '<blockquote><dl><dt>t</dt><dd>d</dd></dl></blockquote><p>tail</p>'],
  ['> - a\n>   - para\n>     [^f]: n\ntail\n', '<blockquote><ul><li>a <ul><li>para</li></ul></li></ul></blockquote><p>tail</p>'],
  ['> - para\n>   [^f]: n\n- tail\n', `${quotedList}<ul><li>tail</li></ul>`],
  ['> - para\n>   [^f]: n\n  tail\n', `${quotedList}<p>tail</p>`],
  ['- > - para\n  >   [^f]: n\ntail\n', `<ul><li>${quotedList}</li></ul><p>tail</p>`],
  ['- > - para\n  >   [^f]: n\n  tail\n', `<ul><li>${quotedList} tail </li></ul>`],
  ['- a\n  - para\n    [^f]: n\n      more\nx\n', '<ul><li>a <ul><li>para</li></ul></li></ul><p>x</p>'],
])('ends the host after the note in %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

it.each([
  ['> - para\n>   [^f]: n\n>   more\ntail\n', quotedList],
  ['> - para\n>   [r]: /u\ntail\n', `${quotedList}<p>tail</p>`],
])('keeps the unchanged neighbor %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})
