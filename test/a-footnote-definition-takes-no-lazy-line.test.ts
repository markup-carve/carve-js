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
  // A marker misses the note and closes it (PART 0 S3, carve#4860).
  ['> - para\n>   [^f]: n\n- tail\n', `${quotedList}<ul><li>tail</li></ul>`],
  ['> - para\n>   [^f]: n\n  tail\n', quotedList],
  ['- > - para\n  >   [^f]: n\ntail\n', `<ul><li>${quotedList}</li></ul>`],
  ['- > - para\n  >   [^f]: n\n  tail\n', `<ul><li>${quotedList}</li></ul>`],
  ['- a\n  - para\n    [^f]: n\n      more\nx\n', '<ul><li>a <ul><li>para</li></ul></li></ul>'],
])('folds the line into the note in %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

it.each([
  ['> - para\n>   [^f]: n\n>   more\ntail\n', quotedList],
  // The erased definition goes with its `>`, so the item paragraph takes the line (carve#5129).
  ['> - para\n>   [r]: /u\ntail\n', '<blockquote><ul><li>para tail</li></ul></blockquote>'],
])('keeps the unchanged neighbor %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})
