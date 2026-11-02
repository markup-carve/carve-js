import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalized = (html: string) => html
  .replace(/\s+/g, ' ')
  .replace(/ ?(<[^>]+>) ?/g, '$1')
  .trim()

const cases = [
  ['quoted term', `> :: t
tail`, '<blockquote><dl><dt>t</dt></dl></blockquote><p>tail</p>'],
  ['below-column plain line', `> :: t
 tail`, '<blockquote><dl><dt>t</dt></dl></blockquote><p>tail</p>'],
  ['quoted list item', `> - :: t
tail`, '<blockquote><ul><li><dl><dt>t</dt></dl></li></ul></blockquote><p>tail</p>'],
  ['below-column line in a quoted item', `> - :: t
 tail`, '<blockquote><ul><li><dl><dt>t</dt></dl></li></ul></blockquote><p>tail</p>'],
  ['nested quote', `> > :: t
tail`, '<blockquote><blockquote><dl><dt>t</dt></dl></blockquote></blockquote><p>tail</p>'],
  ['following quoted term', `> :: a
> :: t
tail`, '<blockquote><dl><dt>a</dt><dt>t</dt></dl></blockquote><p>tail</p>'],
  ['term in a quoted description', `> :: a
> : :: t
tail`, '<blockquote><dl><dt>a</dt><dd><dl><dt>t</dt></dl></dd></dl><p>tail</p></blockquote>'],
  ['unquoted term', `:: t
tail`, '<dl><dt>t</dt></dl><p>tail</p>'],
  ['unquoted list item', `- :: t
tail`, '<ul><li><dl><dt>t</dt></dl></li></ul><p>tail</p>'],
  ['following unquoted term', `:: a
:: t
tail`, '<dl><dt>a</dt><dt>t</dt></dl><p>tail</p>'],
  ['blank ends continuation', `> :: t

tail`, '<blockquote><dl><dt>t</dt></dl></blockquote><p>tail</p>'],
  ['heading ends continuation', `> :: t
# tail`, '<blockquote><dl><dt>t</dt></dl></blockquote><section><h1>tail</h1></section>'],
]

// carve#4861: a term takes no lazy line, so an unprefixed line ends every container it misses.
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
        ? '</blockquote>\n<dl>\n  <dt>b</dt>\n</dl>\n<p>tail</p>'
        : '</blockquote>\n<p>: a\ntail</p>')
    })
    for (const indent of [1, 2, 4]) {
      it(`ends ${marker} below ${lead} with ${indent} spaces`, () => {
        const html = renderHtml(parse(`${lead}\n${' '.repeat(indent)}${marker}\ntail\n`))
        expect(normalized(html)).toContain('<dt>t</dt></dl>')
        if (marker.startsWith('::')) expect(html).toContain('</blockquote>\n<dl>\n  <dt>b</dt>\n</dl>\n<p>tail</p>')
        else expect(html).toContain('</blockquote>\n<p>: a\ntail</p>')
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
])('reads a marked line after the term as its own block in %s', (lead, continuation) => {
  for (const marker of [': a', ':: b']) {
    const html = renderHtml(parse(`${lead}\n${continuation}\n${marker}\ntail\n`))
    expect(normalized(html)).toContain('<dt>t</dt></dl>')
    expect(normalized(html)).not.toContain('<dt>t more')
    if (marker.startsWith('::')) expect(html).toContain('</blockquote>\n<dl>\n  <dt>b</dt>\n</dl>\n<p>tail</p>')
    else expect(html).toContain('more\n: a\ntail')
  }
})

it('clears the term state when a marked description opens', () => {
  const html = renderHtml(parse('> :: t\n> : a\n: b\ntail\n'))
  expect(html).toContain('<dd>a')
  expect(html).not.toContain('</blockquote>\n<p>: b')
  // A marked line between them is a paragraph, so `: a` is its text (carve#4861).
  expect(renderHtml(parse('> :: t\n> more\n> : a\n: b\ntail\n'))).not.toContain('<dd>')
})
