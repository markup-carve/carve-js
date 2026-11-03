import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A description whose marker line stacks a quote with a first-block `+` keeps a
// quoted line at the quote's column after the attached block in that quote.
const html = (src: string): string => carveToHtml(src).replace(/>\s+</g, '><').trim()

describe('a description-stacked quote reads on at its quoted line', () => {
  it.each([
    ['description stacking a quote', ':: t\n: > +\n  x\n  > q\n',
      '<dl><dt>t</dt><dd><blockquote><p>x</p><p>q</p></blockquote></dd></dl>'],
    ['quoted line one column deeper', ':: t\n: > +\n  x\n   > q\n',
      '<dl><dt>t</dt><dd><blockquote><p>x</p><p>q</p></blockquote></dd></dl>'],
    ['lazy line after the quoted line', ':: t\n: > +\n  x\n  > q\n  r\n',
      "<dl><dt>t</dt><dd><blockquote><p>x</p><p>q\nr</p></blockquote></dd></dl>"],
    ['list follower', ':: t\n: > +\n  - x\n  > q\n',
      '<dl><dt>t</dt><dd><blockquote><ul><li>x</li></ul><p>q</p></blockquote></dd></dl>'],
    ['two stacked quotes', ':: t\n: > > +\n  x\n  > q\n',
      "<dl><dt>t</dt><dd><blockquote><blockquote></blockquote></blockquote><p>x</p><blockquote><p>q</p></blockquote></dd></dl>"],
    ['description inside a quote', '> :: t\n> : > +\n>   x\n>   > q\n',
      '<blockquote><dl><dt>t</dt><dd><blockquote><p>x</p><p>q</p></blockquote></dd></dl></blockquote>'],
    ['wider description lead', ':: t\n:  > +\n   x\n   > q\n',
      '<dl><dt>t</dt><dd><blockquote><p>x</p><p>q</p></blockquote></dd></dl>'],
    ['quoted line after a blank keeps its own quote', ':: t\n: > +\n  x\n\n  > q\n',
      '<dl><dt>t</dt><dd><blockquote><p>x</p></blockquote><blockquote><p>q</p></blockquote></dd></dl>'],
  ])('%s', (_name, src, expected) => {
    expect(html(src)).toBe(expected)
  })
})
