import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string): string => html.split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it('a footnote boundary leaves no list paragraph claim', () => {
  const source = '- a\n   [^n]: e\n     q\nl\n'
  const expected = '<ul>\n  <li>a</li>\n</ul>\n<p>l</p>'
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})

it('an open nested note claims a later item line', () => {
  const source = '- a\n   [^n]: e\n     q\n  p\nl\n'
  const expected = "<ul>\n  <li>a</li>\n</ul>"
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})

it('a quoted footnote body leaves no claim for an unmarked line', () => {
  const source = '> quote\n> [^n]: note\n>   - a\n>     q\ntext\n'
  const expected = '<blockquote><p>quote</p></blockquote>\n<p>text</p>'
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})

it('a footnote in two quote levels leaves no claim for an unmarked line', () => {
  const source = '> > q\n> > [^n]: e\n> >   - a\n> >     q\ntext\n'
  const expected = '<blockquote>\n  <blockquote><p>q</p></blockquote>\n</blockquote>\n<p>text</p>'
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})

it('a footnote in three quote levels leaves no claim for an unmarked line', () => {
  const source = '> > > q\n> > > [^n]: e\n> > >   - a\n> > >     q\ntext\n'
  const expected = '<blockquote>\n  <blockquote>\n    <blockquote><p>q</p></blockquote>\n  </blockquote>\n</blockquote>\n<p>text</p>'
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})

it('a marked quote line remains in an open note paragraph', () => {
  const source = '> q\n> [^n]: e\n>   - a\n> p\nx\n'
  const expected = "<blockquote><p>q</p></blockquote>"
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})

it('a note paragraph keeps a marked and unmarked follower', () => {
  const source = '> q\n> [^n]: e\n>   - a\n>     q\n> p\nx\n'
  const expected = "<blockquote><p>q</p></blockquote>"
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})

it('a fence after a footnote boundary closes without claiming the next line', () => {
  const source = '- [^a]: text\n    - child\n    [^b]: inner\n      more\n    ~~~\n    code\n    ~~~\n  more\n  ~~~\n  x\n  ~~~\nbelow\n\n[^a] [^b]\n'
  const expected = '<ul>\n  <li>\n    <pre><code>code\n</code></pre>\n    more\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>\n<p>below</p>\n<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>text\n- child<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n    <li id="fn2">\n      <p>inner\nmore<a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'
  expect(normalize(carveToHtml(source))).toBe(normalize(expected))
})
