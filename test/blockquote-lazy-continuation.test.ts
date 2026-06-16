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

  it('lets a visible block marker interrupt the quote paragraph', () => {
    // A block-opener ends the quote and starts that block OUTSIDE it (§10),
    // exactly as it interrupts a paragraph -- it does NOT fold into the quote.
    expect(html('> a\n# H')).toBe(
      '<blockquote><p>a</p></blockquote>\n<section id="H">\n  <h1>H</h1>\n</section>',
    )
  })

  it('a bullet marker ends the quote and starts a sibling list', () => {
    // A bullet does not fold into an open quote paragraph; it ends the quote
    // and opens a top-level sibling list (Option D, matches djot).
    expect(html('> q\n- one')).toBe(
      '<blockquote><p>q</p></blockquote>\n<ul>\n  <li>one</li>\n</ul>',
    )
  })

  it('an ordered marker ends the quote and starts a sibling list', () => {
    expect(html('> q\n1. one')).toBe(
      '<blockquote><p>q</p></blockquote>\n<ol>\n  <li>one</li>\n</ol>',
    )
  })

  it('plain text still folds into the quote paragraph', () => {
    expect(html('> q\nplain')).toBe('<blockquote><p>q\nplain</p></blockquote>')
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
      '<blockquote>\n  <pre><code>a\n</code></pre>\n</blockquote>\n<p>b</p>\n<blockquote><p>c</p></blockquote>',
    )
  })

  it('keeps an unterminated `:::note` inside a quote literal (no closer in scope)', () => {
    // The quote's own content is just `:::note`; its `:::` closer sits on a
    // separately-marked line that lazy continuation does not fold in, so there
    // is no closer in scope and the opener is NOT an admonition (grammar:
    // `admonition = open … close`). It stays a literal paragraph rather than
    // opening an empty aside. (Deeply underspecified blockquote corner;
    // carve-php/carve-rs still open an empty aside here — tracked for a spec
    // decision + alignment.)
    expect(html('> :::note\nbody\n> :::')).toBe(
      '<blockquote><p>:::note</p></blockquote>\n<p>body</p>\n<blockquote><p>:::</p></blockquote>',
    )
  })

  it('keeps a fence-looking line mid-paragraph as paragraph text and folds the lazy line', () => {
    // The fence has no matching closer, so it does not interrupt the paragraph
    // (§10 closer lookahead) and the lazy line still folds. The mid-paragraph
    // ``` is then an unclosed inline verbatim run, rendering as a <code> span to
    // the end of the block (matches djot upstream + carve-php).
    expect(html('> text\n> ```\nlazy')).toBe(
      '<blockquote><p>text\n<code>\nlazy</code></p></blockquote>',
    )
  })

  it('still folds a lazy line that continues a paragraph open inside a div', () => {
    expect(html('> :::note\n> para\nlazy\n> :::')).toBe(
      '<blockquote>\n  <aside class="admonition note">\n    <p>para\nlazy</p>\n  </aside>\n</blockquote>',
    )
  })
})
