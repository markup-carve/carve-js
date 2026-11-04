import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (html: string): string => html.replace(/>\s+</g, '><').trim()

// carve#5129, PART 0 S1: an erased line goes with its quote prefixes, so the output is that of the document without it.
describe('an erased quoted line goes with its quote prefix', () => {
  it('keeps one quoted paragraph across a comment', () => {
    expect(carveToHtml('> a\n> %% c\n> b\n')).toBe('<blockquote><p>a\nb</p></blockquote>')
  })

  it('lets a quoted plus skip an abbreviation definition', () => {
    expect(compact(carveToHtml('> - +\n> *[A]: b\n> text\n\nA\n')))
      .toBe('<blockquote><ul><li>text</li></ul></blockquote><p><abbr title="b">A</abbr></p>')
  })

  it('keeps one loose list across two column-0 comments', () => {
    expect(compact(carveToHtml('> - a\n>\n>   %% y\n> %% z\n> - c\n')))
      .toBe('<blockquote><ul><li><p>a</p></li><li><p>c</p></li></ul></blockquote>')
  })

  it.each([
    ['> a\n> %% c\n> b\n', '> a\n> b\n'],
    ['> > a\n> > %% c\n> > b\n', '> > a\n> > b\n'],
    ['> - a\n>   %% c\n>   b\n', '> - a\n>   b\n'],
    ['> - a\n> %% c\ntail\n', '> - a\ntail\n'],
    ['> :: t\n> : d\n>   %% c\ntail\n', '> :: t\n> : d\ntail\n'],
    ['- > a\n  > %% c\n  > b\n', '- > a\n  > b\n'],
    ['> > a\n > +\n > %% c\n > b\n', '> > a\n > +\n > b\n'],
  ])('reads %j as the document without the line', (source, twin) => {
    expect(carveToHtml(source)).toBe(carveToHtml(twin))
  })

  it('keeps a quote the erased line opens', () => {
    expect(compact(carveToHtml('> %% c\n'))).toBe('<blockquote></blockquote>')
  })
})
