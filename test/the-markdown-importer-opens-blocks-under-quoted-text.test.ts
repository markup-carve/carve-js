import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

const html = (md: string): string => carveToHtml(markdownToCarve(md)).replace(/>\n\s*/g, '>').replace(/\n\s*</g, '<')

describe('the Markdown importer opens a list under quoted paragraph text', () => {
  // A list interrupts a paragraph in a quote too (markup-carve/carve#4935).
  it.each([
    ['> [!Note]\n> - Foo\n', '> [!Note]\n>\n> - Foo\n'],
    ['> a\n> 1. Foo\n', '> a\n>\n> 1. Foo\n'],
    ['> > a\n> > * Foo\n', '> > a\n> >\n> > * Foo\n'],
    ['- > a\n  > - Foo\n', '- > a\n  >\n  > - Foo\n'],
  ])('%j', (md, carve) => {
    expect(markdownToCarve(md)).toBe(carve)
  })

  it('keeps an ordered marker other than 1 as paragraph text', () => {
    expect(html('> a\n> 2. Foo\n')).toBe('<blockquote><p>a\n2. Foo</p></blockquote>')
  })

  it('keeps a sublist under an item paragraph tight', () => {
    expect(markdownToCarve('> - x\n>   a\n>   - Foo\n')).toBe('> - x\n>   a\n>   - Foo\n')
  })
})

describe('the Markdown importer reads indented code after a quoted heading or rule', () => {
  // Indented code needs no blank line after a single-line block (markup-carve/carve#4944).
  it.each([
    ['> ---\n>\t\ttest\n', '<blockquote><hr><pre><code>  test</code></pre></blockquote>'],
    ['> # h\n>     a\n>     b\n> c\n', '<blockquote><h1 id="h">h</h1><pre><code>a\nb</code></pre><p>c</p></blockquote>'],
    ['> a\n> ===\n>     x\n', '<blockquote><h1 id="a">a</h1><pre><code>x</code></pre></blockquote>'],
  ])('%j', (md, expected) => {
    expect(html(md)).toBe(expected)
  })

  it('keeps a lazy paragraph line after a lone `===` as text', () => {
    expect(html('> ===\n>     x\n')).toBe('<blockquote><p>===\nx</p></blockquote>')
    expect(html('> # h\n> ===\n>     x\n')).toBe('<blockquote><h1 id="h">h</h1><p>===\nx</p></blockquote>')
    expect(html('> a\n> ===\n> ===\n>     x\n')).toBe('<blockquote><h1 id="a">a</h1><p>===\nx</p></blockquote>')
  })
})

describe('the Markdown target keeps a rule after a quote in a tight item', () => {
  // A star rule ends the quote without a blank line (markup-carve/carve#4949).
  it('writes `***` under the quote', () => {
    expect(carveToMarkdown('- a\n  > q\n   ---\n')).toBe('- a\n  > q\n  ***\n')
  })
})
