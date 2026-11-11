import { expect, test } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const html = (source: string): string => renderHtml(parse(source)).replace(/\s+/g, '')

// carve-js#4978: the ownership walk cuts the item's lead from `rootLines`; the description column is read in the marker's frame.
test('a description under an indented quoted item keeps its marker-line term', () => {
  expect(html('>   - :: t\n>     : a\n')).toBe('<blockquote><ul><li><dl><dt>t</dt><dd>a</dd></dl></li></ul></blockquote>')
  expect(html('>   - :: t\n>     : a\n>     : b\n')).toBe('<blockquote><ul><li><dl><dt>t</dt><dd>a</dd><dd>b</dd></dl></li></ul></blockquote>')
  expect(html('> >    * :: t\n> >      : a\n')).toBe('<blockquote><blockquote><ul><li><dl><dt>t</dt><dd>a</dd></dl></li></ul></blockquote></blockquote>')
})

test('a separator at the quoted item marker column still releases the term', () => {
  expect(html('>   - :: t\n>   : a\n')).toBe('<blockquote><ul><li><dl><dt>t</dt></dl></li></ul><p>:a</p></blockquote>')
})
