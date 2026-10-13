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

for (const lead of ['> :: t', '> - :: t', '> 1. :: t', '> > :: t']) {
  for (const marker of [': a', ':: b']) {
    it(`ends ${lead} before a document-column ${marker}`, () => {
      const html = renderHtml(parse(`${lead}\n${marker}\ntail\n`))
      expect(html).toContain('<dt>t</dt>')
      expect(html).toContain(marker.startsWith('::')
        ? '</blockquote>\n<dl>\n  <dt>b\ntail</dt>'
        : '</blockquote>\n<p>: a\ntail</p>')
    })
    for (const indent of [1, 2, 4]) {
      it(`folds ${marker} below ${lead} with ${indent} spaces`, () => {
        const html = renderHtml(parse(`${lead}\n${' '.repeat(indent)}${marker}\ntail\n`))
        expect(normalized(html)).toContain(`<dt>t ${marker} tail</dt>`)
        expect(html).not.toContain('<dd>')
      })
    }
  }
}

it.each([
  ['> :: t', '> more'],
  ['> - :: t', '>   more'],
  ['> 1. :: t', '>    more'],
  ['> > :: t', '> > more'],
])('keeps the term boundary after a marked continuation in %s', (lead, continuation) => {
  for (const marker of [': a', ':: b']) {
    const html = renderHtml(parse(`${lead}\n${continuation}\n${marker}\ntail\n`))
    expect(normalized(html)).toContain('<dt>t more</dt>')
    expect(html).toContain(marker.startsWith('::')
      ? '</blockquote>\n<dl>\n  <dt>b\ntail</dt>'
      : '</blockquote>\n<p>: a\ntail</p>')
  }
})

it('clears the term state when a marked description opens', () => {
  for (const continuation of ['', '> more\n']) {
    const html = renderHtml(parse(`> :: t\n${continuation}> : a\n: b\ntail\n`))
    expect(html).toContain('<dd>a')
    expect(html).not.toContain('</blockquote>\n<p>: b')
  }
})
