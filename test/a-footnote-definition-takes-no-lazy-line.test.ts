import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A footnote takes a lazy line while its paragraph remains open (carve#3885), so the
// unreferenced note takes the line with it.
const html = (source: string): string => carveToHtml(source).replace(/\s+/g, ' ').replace(/> </g, '><').trim()

const quotedList = '<blockquote><ul><li>para</li></ul></blockquote>'

it.each([
  ['> - para\n>   [^f]: n\ntail\n', quotedList],
  ['> 1. para\n>    [^f]: n\ntail\n', '<blockquote><ol><li>para</li></ol></blockquote>'],
  ['> > - para\n> >   [^f]: n\ntail\n', '<blockquote><blockquote><ul><li>para</li></ul></blockquote></blockquote>'],
  // A fence interrupts the note paragraph (carve#4018), so this row folds nothing.
  ['> - para\n>   [^f]: n\n```\ncode\n', `${quotedList}<pre><code>code </code></pre>`],
  ['> - para\n>   [^f]: n\n>     more\ntail\n', quotedList],
  ['> :: t\n> : d\n>   [^f]: n\ntail\n', '<blockquote><dl><dt>t</dt><dd>d</dd></dl></blockquote>'],
  ['> - a\n>   - para\n>     [^f]: n\ntail\n', '<blockquote><ul><li>a <ul><li>para</li></ul></li></ul></blockquote>'],
  ['> - para\n>   [^f]: n\n- tail\n', quotedList],
  ['> - para\n>   [^f]: n\n  tail\n', quotedList],
  ['- > - para\n  >   [^f]: n\ntail\n', `<ul><li>${quotedList}</li></ul>`],
  ['- > - para\n  >   [^f]: n\n  tail\n', `<ul><li>${quotedList}</li></ul>`],
  ['- a\n  - para\n    [^f]: n\n      more\nx\n', '<ul><li>a <ul><li>para</li></ul></li></ul>'],
])('folds the line into the note in %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

it.each([
  ['> - para\n>   [^f]: n\n>   more\ntail\n', quotedList],
  ['> - para\n>   [r]: /u\ntail\n', `${quotedList}<p>tail</p>`],
])('keeps the unchanged neighbor %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})
