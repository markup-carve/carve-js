import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const compact = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, '')

describe('quote-prefixed continuation markers', () => {
  it.each([
    ['>+', '<p>&gt;+</p>'],
    ['>>+', '<p>&gt;&gt;+</p>'],
    ['>> +', '<p>&gt;&gt; +</p>'],
    ['> >+', '<blockquote><p>&gt;+</p></blockquote>'],
  ])('reads glued %s as text', (source, expected) => {
    expect(compact(source)).toBe(expected)
  })

  it('lints a glued quote marker', () => {
    expect(lintCarve('>+').map(warning => warning.rule)).toContain('blockquote-marker-without-space')
  })

  it.each([
    ['> > q\n> +\n> > r', '<blockquote><blockquote><p>q</p><blockquote><p>r</p></blockquote></blockquote></blockquote>'],
    ['> - a\n> +\n> > r', '<blockquote><ul><li>a<blockquote><p>r</p></blockquote></li></ul></blockquote>'],
    ['> :: t\n> : a\n> +\n> > q', '<blockquote><dl><dt>t</dt><dd><p>a</p><blockquote><p>q</p></blockquote></dd></dl></blockquote>'],
    ['> - > a\n>   +\n>   b', '<blockquote><ul><li><blockquote><p>a</p><p>b</p></blockquote></li></ul></blockquote>'],
    ['> - x\n>   - > a\n>     +\n>     b', '<blockquote><ul><li>x<ul><li><blockquote><p>a</p><p>b</p></blockquote></li></ul></li></ul></blockquote>'],
    ['> > - a\n> +\n> para', '<blockquote><blockquote><ul><li>a</li></ul><p>para</p></blockquote></blockquote>'],
    ['> - a\n>\n> +\n> para', '<blockquote><ul><li>apara</li></ul></blockquote>'],
  ])('attaches at the addressed quote level in %s', (source, expected) => {
    expect(compact(source)).toBe(expected)
  })

  it('attaches a deeper quote to a footnote inside a quote', () => {
    expect(compact('> [^a]: a\n> +\n> > q\n\nr[^a]')).toBe(
      '<blockquote></blockquote><p>r<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>' +
      '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">' +
      '<p>a</p><blockquote><p>q</p></blockquote>' +
      '<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>' +
      '</li></ol></section>',
    )
  })

  it.each([
    ['> a\n> +\n> > q', '<blockquote><p>a+</p><blockquote><p>q</p></blockquote></blockquote>'],
    ['> > q\n> > +\n> > - s', '<blockquote><blockquote><p>q+- s</p></blockquote></blockquote>'],
  ])('keeps an unaddressed marker as text in %s', (source, expected) => {
    expect(compact(source)).toBe(expected)
  })
})
