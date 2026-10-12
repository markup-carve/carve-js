import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalized = (html: string) => html
  .replace(/\s+/g, ' ')
  .replace(/ ?(<[^>]+>) ?/g, '$1')
  .trim()

const cases = [
  ['quoted term', `> :: t
tail`, '<blockquote><dl><dt>t tail</dt></dl></blockquote>'],
  ['below-column plain line', `> :: t
 tail`, '<blockquote><dl><dt>t tail</dt></dl></blockquote>'],
  ['quoted list item', `> - :: t
tail`, '<blockquote><ul><li><dl><dt>t tail</dt></dl></li></ul></blockquote>'],
  ['below-column line in a quoted item', `> - :: t
 tail`, '<blockquote><ul><li><dl><dt>t tail</dt></dl></li></ul></blockquote>'],
  ['nested quote', `> > :: t
tail`, '<blockquote><blockquote><dl><dt>t tail</dt></dl></blockquote></blockquote>'],
  ['following quoted term', `> :: a
> :: t
tail`, '<blockquote><dl><dt>a</dt><dt>t tail</dt></dl></blockquote>'],
  ['term in a quoted description', `> :: a
> : :: t
tail`, '<blockquote><dl><dt>a</dt><dd><dl><dt>t tail</dt></dl></dd></dl></blockquote>'],
  ['unquoted term', `:: t
tail`, '<dl><dt>t tail</dt></dl>'],
  ['unquoted list item', `- :: t
tail`, '<ul><li><dl><dt>t tail</dt></dl></li></ul>'],
  ['following unquoted term', `:: a
:: t
tail`, '<dl><dt>a</dt><dt>t tail</dt></dl>'],
  ['blank ends continuation', `> :: t

tail`, '<blockquote><dl><dt>t</dt></dl></blockquote><p>tail</p>'],
  ['heading ends continuation', `> :: t
# tail`, '<blockquote><dl><dt>t</dt></dl></blockquote><section><h1>tail</h1></section>'],
]

describe('a quoted term takes a lazy line', () => {
  it.each(cases)('%s', (_name, source, expected) => {
    expect(normalized(renderHtml(parse(source)))).toBe(expected)
    expect(normalized(renderHtml(parse(source, { positions: true })))).toBe(expected)
  })
})
