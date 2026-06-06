import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('blockquote lazy continuation (CommonMark-style, matches carve-php)', () => {
  it('folds a non-`>` line into the quote paragraph', () => {
    expect(html('> quoted\ncontinued')).toBe(
      '<blockquote><p>quoted\ncontinued</p></blockquote>',
    )
  })

  it('folds several lazy lines', () => {
    expect(html('> q\ntext\nmore')).toBe(
      '<blockquote><p>q\ntext\nmore</p></blockquote>',
    )
  })

  it('a blank line still ends the quote', () => {
    expect(html('> q\n\ntext')).toBe(
      '<blockquote><p>q</p></blockquote>\n<p>text</p>',
    )
  })

  it('folds a line that looks like a block marker (paragraphs are never interrupted)', () => {
    expect(html('> a\n# H')).toBe('<blockquote><p>a\n# H</p></blockquote>')
  })

  it('a caption attaches to the quote rather than folding in', () => {
    expect(html('> quote\n^ Caption')).toBe(
      '<figure>\n  <blockquote><p>quote</p></blockquote>\n  <figcaption>Caption</figcaption>\n</figure>',
    )
  })

  it('a `>`-prefixed line still continues the quote', () => {
    expect(html('> a\n> b')).toBe('<blockquote><p>a\nb</p></blockquote>')
  })
})

describe('blockquote lazy continuation only extends an open paragraph', () => {
  it('does not swallow a non-`>` line into an open fenced code block', () => {
    // `b` and `> c` must leave the quote, not be pulled into the code block
    // (with the `>` stripped). The quote ends at the first non-`>` line.
    expect(html('> ```\n> a\nb\n> c')).toBe(
      '<blockquote>\n  <pre><code>a\n</code></pre>\n</blockquote>\n<p>b\n&gt; c</p>',
    )
  })

  it('does not pull a non-`>` line into a just-opened div', () => {
    expect(html('> :::note\nbody\n> :::')).toBe(
      '<blockquote>\n  <aside class="admonition note">\n\n  </aside>\n</blockquote>\n<p>body\n&gt; :::</p>',
    )
  })

  it('keeps a fence-looking line mid-paragraph as paragraph text and folds the lazy line', () => {
    // A fence never interrupts an open paragraph, so the lazy line still folds.
    expect(html('> text\n> ```\nlazy')).toBe(
      '<blockquote><p>text\n```\nlazy</p></blockquote>',
    )
  })

  it('still folds a lazy line that continues a paragraph open inside a div', () => {
    expect(html('> :::note\n> para\nlazy\n> :::')).toBe(
      '<blockquote>\n  <aside class="admonition note">\n    <p>para\nlazy</p>\n  </aside>\n</blockquote>',
    )
  })
})
