import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (html: string): string => html.replace(/>\s+</g, '><').trim()

// carve#5886, PART 0 S1 and S4: a `%%%` below a note's body column ends the note; the text line left
// of the fence's column ends the span, and the unmarked line after it continues that paragraph lazily.
describe('a lazy line after a quoted comment span the host ends', () => {
  it.each([
    ['> > - [^n]: a\n> >   %%%\n> > z\nplain\n\nx[^n]\n', '<blockquote><blockquote><ul><li></li></ul><p>z\nplain</p></blockquote></blockquote>'],
    ['> > - a\n> >   %%%\n> > z\nplain\n', '<blockquote><blockquote><ul><li>a</li></ul><p>z\nplain</p></blockquote></blockquote>'],
    ['> - [^n]: a\n>   %%%\n> z\nplain\n\nx[^n]\n', '<blockquote><ul><li></li></ul><p>z\nplain</p></blockquote>'],
    ['> :: t\n> : [^n]: a\n>   %%%\n> z\nplain\n\nx[^n]\n', '<blockquote><dl><dt>t</dt><dd></dd></dl><p>z\nplain</p></blockquote>'],
    ['> > :: t\n> > : [^n]: a\n> >   %%%\n> > z\nplain\n\nx[^n]\n', '<blockquote><blockquote><dl><dt>t</dt><dd></dd></dl><p>z\nplain</p></blockquote></blockquote>'],
  ])('folds the lazy line in %j', (source, html) => {
    expect(compact(carveToHtml(source))).toContain(html)
  })
})
